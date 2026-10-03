// =============================================================================
// Novastar Montessori School - TeamCity build chain
//
// Scope, deliberately narrow:
//
//   TeamCity owns LOCAL work on the agent: install, verify, e2e, build the two
//   container images, and run them in docker compose. That is the "CI/CD for
//   local deploy and builds" this pipeline is for.
//
//   GitHub Actions (.github/workflows/ci.yml) already runs the trunk CI and owns
//   the automatic Vercel production deploy. Two systems pushing production would
//   race, so DeployVercelProduction here has no VCS trigger and must be started
//   by hand. Delete it if you decide GitHub Actions is the only deploy path.
//
// Design notes that are not obvious from the file:
//
//  * Cross-platform. Every step runs one `bun run ci:<task>` with no shell
//    syntax (no &&, no $VAR). That works unchanged on Windows cmd.exe, Git Bash
//    and a Linux agent, which matters because the TeamCity server here is
//    C:\TeamCity. All real logic lives in scripts/ci/*.ts where it is testable.
//
//  * cleanCheckout = false is the fast local cache. Dependencies, .turbo and the
//    BuildKit cache in .docker-cache survive between builds on the agent, so a
//    repeat run skips work instead of re-doing it.
//
//  * Two more cache layers on top of that: TURBO_TOKEN enables Turborepo's
//    remote cache (an unchanged task in an unchanged package is restored, not
//    re-run), and each Dockerfile's `deps` stage copies only package.json
//    manifests before `bun install`, so editing a .tsx file cannot invalidate
//    the install layer.
//
//  * `prisma migrate deploy` is deliberately absent. The live Neon database was
//    built with `prisma db push`, so it has no _prisma_migrations table, and
//    the checked-in init migration is bare CREATE TABLE statements that would
//    fail partway and record a half-applied migration against a real database.
//
// To register this: Administration -> Project -> Versioned Settings -> Kotlin,
// repository pekay23/novastarmontissorischool, branch main, settings directory
// .teamcity. TeamCity compiles this file and reports any error with a line
// number, so a mistake here is reported rather than silently ignored.
// =============================================================================

import jetbrains.buildServer.configs.kotlin.v2024_07.BuildStatus
import jetbrains.buildServer.configs.kotlin.v2024_07.BuildType
import jetbrains.buildServer.configs.kotlin.v2024_07.Project
import jetbrains.buildServer.configs.kotlin.v2024_07.ReuseBuilds
import jetbrains.buildServer.configs.kotlin.v2024_07.buildSteps.script
import jetbrains.buildServer.configs.kotlin.v2024_07.dependencies.snapshot
import jetbrains.buildServer.configs.kotlin.v2024_07.parameters.password
import jetbrains.buildServer.configs.kotlin.v2024_07.parameters.text
import jetbrains.buildServer.configs.kotlin.v2024_07.parameters.*
import jetbrains.buildServer.configs.kotlin.v2024_07.triggers.finishedBuild
import jetbrains.buildServer.configs.kotlin.v2024_07.triggers.vcs
import jetbrains.buildServer.configs.kotlin.v2024_07.vcsRoots.git

version = "2024.07"

project {
    id("NovastarMontessori")
    name = "Novastar Montessori School"
    description = "Local CI/CD for the Novastar Montessori monorepo (Turborepo + Bun + Next.js)"

    vcsRoots {
        git {
            id("NovastarMontessori_nmsGit")
            name = "novastarmontissorischool"
            url = "https://github.com/pekay23/novastarmontissorischool.git"
            // Pull requests are GitHub Actions' job; TeamCity works on the trunk.
            branchFilter = "+:refs/heads/*"
        }
    }

    // -------------------------------------------------------------------------
    // Parameters
    //
    // Secrets are declared as `password` so TeamCity masks them in build logs.
    // The placeholder below is NOT a working value: scripts/ci/deploy-vercel.ts
    // calls requireEnv() and aborts, so a deploy fails loudly instead of going
    // out with a placeholder.
    //
    // Override the real values in the UI:
    //   Administration -> Project -> Parameters
    // -------------------------------------------------------------------------
    parameters {
        // --- Build cache ---
        param("env.TURBO_TOKEN", password("SET_IN_TEAMCITY"))
        param("env.TURBO_TEAM", "pekay23")

        // --- Database (Neon. packages/database uses @prisma/adapter-neon, which
        //     speaks SQL-over-HTTP, so a local postgres container cannot serve it.) ---
        param("env.DATABASE_URL", password("SET_IN_TEAMCITY"))
        param("env.DIRECT_URL", password("SET_IN_TEAMCITY"))
        param("env.SUPABASE_DATABASE_URL", password("SET_IN_TEAMCITY"))

        // --- Auth ---
        param("env.NEXTAUTH_SECRET", password("SET_IN_TEAMCITY"))
        param("env.NEXTAUTH_URL", "http://localhost:3000")

        // --- Public, inlined into the client bundle at build time ---
        param("env.NEXT_PUBLIC_ORIGIN", "http://localhost:3000")
        param("env.NEXT_PUBLIC_DOMAIN", "localhost:3000")

        // --- Integrations ---
        param("env.UPSTASH_REDIS_REST_URL", password("SET_IN_TEAMCITY"))
        param("env.UPSTASH_REDIS_REST_TOKEN", password("SET_IN_TEAMCITY"))
        param("env.RESEND_API_KEY", password("SET_IN_TEAMCITY"))
        param("env.MTN_MERCHANT_ID", password("SET_IN_TEAMCITY"))
        param("env.SCHOOL_BANK_NAME", password("SET_IN_TEAMCITY"))
        param("env.SCHOOL_BANK_ACCOUNT", password("SET_IN_TEAMCITY"))
        param("env.S3_BUCKET", password("SET_IN_TEAMCITY"))
        param("env.SUPABASE_URL", password("SET_IN_TEAMCITY"))
        param("env.DEFAULT_SCHOOL_CODE", password("SET_IN_TEAMCITY"))
        param("env.TRUSTED_PROXY_HOPS", "1")

        // --- Vercel ---
        param("env.VERCEL_TOKEN", password("SET_IN_TEAMCITY"))
        param("env.VERCEL_ORG_ID", "SET_IN_TEAMCITY")
        param("env.VERCEL_PROJECT_ID_PORTAL", "SET_IN_TEAMCITY")
        param("env.VERCEL_PROJECT_ID_PUBLIC", "SET_IN_TEAMCITY")

        // --- Container registry (only used when DOCKER_PUSH=true) ---
        param("env.DOCKER_REGISTRY", "ghcr.io")
        param("env.DOCKER_USERNAME", password("SET_IN_TEAMCITY"))
        param("env.DOCKER_PASSWORD", password("SET_IN_TEAMCITY"))
        param("env.DOCKER_TAG", "local")
    }

    buildType(Install)
    buildType(Verify)
    buildType(E2ETest)
    buildType(DockerBuild)
    buildType(DeployLocal)
    buildType(DeployVercelPreview)
    buildType(DeployVercelProduction)
}

// -----------------------------------------------------------------------------
// Install -> Verify -> E2ETest -> { DockerBuild -> DeployLocal
//                                       DeployVercelPreview }
//                                     DeployVercelProduction  (manual only)
// -----------------------------------------------------------------------------

object Install : BuildType({
    id("NovastarMontessori_Install")
    name = "Install"
    description = "Install workspace dependencies and generate the Prisma client"

    vcs {
        root("NovastarMontessori_nmsGit")
        // Keeping the work dir is what preserves the dependency and .turbo
        // caches between builds.
        cleanCheckout = false
    }

    steps {
        script {
            name = "Install and generate"
            scriptContent = "bun run ci:install"
        }
    }

    triggers {
        vcs {
            branchFilter = "+:refs/heads/main"
        }
    }
})

object Verify : BuildType({
    id("NovastarMontessori_Verify")
    name = "Verify"
    description = "Lint, typecheck and unit tests"

    vcs {
        root("NovastarMontessori_nmsGit")
        cleanCheckout = false
    }

    dependencies {
        snapshot {
            buildType = Install
            // ALWAYS: a newer commit that passes lint should not be blocked
            // waiting for the previous commit's build to finish.
            reuseBuilds = ReuseBuilds.ALWAYS
        }
    }

    steps {
        script {
            name = "Lint, typecheck, test"
            scriptContent = "bun run ci:verify"
        }
    }

    triggers {
        finishedBuild {
            buildType = Install
            status = BuildStatus.SUCCESS
            branchFilter = "+:refs/heads/main"
        }
    }
})

object E2ETest : BuildType({
    id("NovastarMontessori_E2ETest")
    name = "E2E Tests"
    description = "Playwright suite (chromium, firefox, webkit) against the portal"

    vcs {
        root("NovastarMontessori_nmsGit")
        cleanCheckout = false
    }

    dependencies {
        snapshot {
            buildType = Verify
            reuseBuilds = ReuseBuilds.ALWAYS
        }
    }

    parameters {
        param("env.CI", "true")
        param("env.E2E_PORT", "3100")
    }

    steps {
        script {
            name = "Install browsers and run E2E"
            scriptContent = "bun run ci:e2e"
        }
    }

    // playwright.config.ts already sets retries: 0 and a 20s per-test timeout, so
    // this ceiling only catches the case where the whole job wedges on a dev
    // server that never comes up.
    features {
        feature {
            type = "timeout"
            param("timeout", "25")
        }
    }

    triggers {
        finishedBuild {
            buildType = Verify
            status = BuildStatus.SUCCESS
            branchFilter = "+:refs/heads/main"
        }
    }
})

object DockerBuild : BuildType({
    id("NovastarMontessori_DockerBuild")
    name = "Docker Build"
    description = "Build both container images with BuildKit layer caching"

    vcs {
        root("NovastarMontessori_nmsGit")
        cleanCheckout = false
    }

    dependencies {
        snapshot {
            buildType = E2ETest
            reuseBuilds = ReuseBuilds.ALWAYS
        }
    }

    steps {
        script {
            name = "Build images"
            scriptContent = "bun run ci:docker"
        }
    }

    triggers {
        finishedBuild {
            buildType = E2ETest
            status = BuildStatus.SUCCESS
            branchFilter = "+:refs/heads/main"
        }
    }
})

object DeployLocal : BuildType({
    id("NovastarMontessori_DeployLocal")
    name = "Deploy (Docker Compose)"
    description = "Run the freshly built images in docker compose on this agent"

    vcs {
        root("NovastarMontessori_nmsGit")
        cleanCheckout = false
    }

    dependencies {
        snapshot {
            buildType = DockerBuild
            reuseBuilds = ReuseBuilds.NEVER
        }
    }

    steps {
        script {
            name = "Compose up"
            // No --build: it would rebuild the images ci:docker just produced and
            // waste the layer cache this pipeline exists to use. --wait blocks
            // until both healthchecks pass.
            scriptContent = "docker compose up -d --wait"
        }
    }

    triggers {
        finishedBuild {
            buildType = DockerBuild
            status = BuildStatus.SUCCESS
            branchFilter = "+:refs/heads/main"
        }
    }
})

object DeployVercelPreview : BuildType({
    id("NovastarMontessori_DeployVercelPreview")
    name = "Deploy Preview (Vercel)"
    description = "Publish a Vercel preview deployment for review"

    vcs {
        root("NovastarMontessori_nmsGit")
        cleanCheckout = false
    }

    dependencies {
        snapshot {
            buildType = E2ETest
            reuseBuilds = ReuseBuilds.NEVER
        }
    }

    parameters {
        param("env.VERCEL_TARGET", "preview")
    }

    steps {
        script {
            name = "vercel pull / build / deploy --prebuilt"
            scriptContent = "bun run ci:deploy"
        }
    }

    triggers {
        finishedBuild {
            buildType = E2ETest
            status = BuildStatus.SUCCESS
            branchFilter = "+:refs/heads/main"
        }
    }
})

object DeployVercelProduction : BuildType({
    id("NovastarMontessori_DeployVercelProduction")
    name = "Deploy Production (Vercel)"
    description = "Publish to Vercel production. Started manually from the TeamCity UI."

    // Manual only, on purpose. GitHub Actions deploys production automatically on
    // a green main; an automatic trigger here as well would have two systems race
    // to publish the same trunk commit.
    //
    // "Manual only" is expressed by having NO triggers block on this BuildType.
    // Do not add runAlways = true to get it: runAlways fires on agent-idle, so it
    // would queue a production deploy nobody asked for, on every idle event.
    vcs {
        root("NovastarMontessori_nmsGit")
        cleanCheckout = false
    }

    dependencies {
        snapshot {
            buildType = E2ETest
            reuseBuilds = ReuseBuilds.NEVER
        }
    }

    parameters {
        param("env.VERCEL_TARGET", "production")
    }

    steps {
        script {
            name = "vercel pull / build / deploy --prebuilt --prod"
            scriptContent = "bun run ci:deploy"
        }
    }

    features {
        feature {
            type = "approval"
            param("approvers", "project_admins")
        }
    }
})