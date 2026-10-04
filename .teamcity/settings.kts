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
//  * There is still no SCHEMA STEP of any kind here, and that is a known gap
//    rather than an oversight: nothing in the chain notices that the repository
//    and the live schema have drifted apart. A read-only gate is cheap in
//    principle -- `bun run db:migrate:verify` (live schema vs schema.prisma)
//    writes nothing and needs no acknowledgement -- but it is NOT wired up on
//    purpose, for reasons that will not be obvious to the next reader:
//
//      - `db:migrate:status` is the wrong gate today. It is red by design while
//        the ledger is empty (four migrations pending, no _prisma_migrations),
//        and baselining is a decision that has been deferred. `verify` is the
//        one that goes green.
//      - `verify` needs env.DATABASE_URL, which is declared above as a password
//        parameter whose committed value is the literal "SET_IN_TEAMCITY"
//        placeholder. Nothing in this chain needs the database today, so this
//        would be a brand-new dependency on a production credential, and its
//        first failure would be a red trunk: Verify gates E2ETest, which gates
//        DockerBuild, DeployLocal and both Vercel deploys.
//      - `verify` also inherits the provider. Measured on 2026-10-03: the
//        pooler endpoint was answering P1001 while the direct endpoint was
//        green, and `verify` resolves DATABASE_URL first. A gate whose colour
//        tracks a provider's health rather than the repository's is a gate
//        people learn to ignore.
//      - Wiring it the way every other step here is wired means one
//        `bun run ci:<task>` backed by a new scripts/ci/*.ts, because a
//        conditional step cannot be expressed without shell syntax and this file
//        deliberately uses none. See scripts/ci/verify.ts, which owns the three
//        existing gates.
//
//    So: after the ledger is reconciled and a real DATABASE_URL is set in the
//    UI, the change is to add `db:migrate:verify` to the task list in
//    scripts/ci/verify.ts. Nothing in this file needs to move for it.
//
// To register this: Administration -> Project -> Versioned Settings -> Kotlin,
// repository pekay23/novastarmontissorischool, branch main, settings directory
// .teamcity. TeamCity compiles this file and reports any error with a line
// number, so a mistake here is reported rather than silently ignored.
// =============================================================================

import jetbrains.buildServer.configs.kotlin.v2019_2.BuildType
import jetbrains.buildServer.configs.kotlin.v2019_2.ReuseBuilds
import jetbrains.buildServer.configs.kotlin.v2019_2.buildSteps.script
import jetbrains.buildServer.configs.kotlin.v2019_2.triggers.finishBuildTrigger
import jetbrains.buildServer.configs.kotlin.v2019_2.triggers.vcs

// There is deliberately no `version = "..."` line.
//
// Declaring one makes TeamCity resolve org.jetbrains.teamcity:configs-dsl-kotlin
// at that version through Maven before it compiles this file. That artifact is in
// no local repository on this server, so every attempt started a cold resolution
// and none finished inside the generator's 120 second ceiling:
//
//   Failed to generate updated settings for revision <sha>:
//   ConfigGenerationException: Configs generator runs longer than 120 seconds
//   (enable debug to see stacktrace)          [teamcity-versioned-settings.log]
//
// Nothing was ever cached, so nothing got faster: caches\dslDependenciesMaven,
// caches\kotlinDslData and caches\maven were all still empty afterwards. Omitting
// the line makes TeamCity use the DSL API it already ships in
// webapps\ROOT\WEB-INF\plugins\.unpacked\configs-dsl\server, which needs no
// network access at all.
//
// The API that ships is 2026.2. Its Kotlin packages stop at v2019_2, which is why
// the imports above say v2019_2. Those are independent axes -- the artifact version
// names the Maven coordinate, the package name is the API generation -- which is
// why pinning "2026.2" while importing v2019_2 was never the contradiction it
// looked like.
//
// Only subpackage symbols need naming here. Everything in the v2019_2 root package
// arrives through the imports TeamCity injects by default: BuildType, ReuseBuilds,
// the Dependencies.snapshot member, the params {} block, and ParametrizedWithType's
// param/password/text. A wildcard import does not reach subpackages, so
// buildSteps.script and the two triggers.* functions must be named explicitly.

project {
    // No id() and no name= here on purpose.
    //
    // Inside project { }, the id and name are NOT this project's own: they are the
    // declaration of a nested project. Kotlin DSL portable scripts therefore bind
    // to whichever project has versioned settings enabled, and setting id() here
    // makes TeamCity read the file as a different, unrecognized project. The error
    // surfaces only as "The settings of the following projects were found in the
    // VCS: <Unrecognized project>".
    //
    // This project's id (NovastarMontessori) and name are owned by the server, set
    // when the project was created. That id is also the prefix every entity id in
    // this file must carry, which is why the build configurations below are named
    // NovastarMontessori_*. Do not reintroduce id()/name= here.
    description = "Local CI/CD for the Novastar Montessori monorepo (Turborepo + Bun + Next.js)"

    // No vcsRoots { } block here on purpose.
    //
    // The v2019_2 package of the 2026.2 DSL API has no `git { }` VCS-root
    // declaration function: the jetbrains.git DSL artifact contributes only the
    // GitVcsRoot model class, no builder. Declaring the root here would fail to
    // compile with "unresolved reference: git".
    //
    // The root is server-side configuration instead. It already exists as
    // NovastarMontessori_nmsGit, with the GitHub PAT, the URL, and
    // branch=refs/heads/main; each build type below references it by id via
    // vcs { root("NovastarMontessori_nmsGit") }. Change it in
    // Administration -> Versioned Settings, not in this file.

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
    params {
        // --- Build cache ---
        param("env.TURBO_TOKEN", password("SET_IN_TEAMCITY"))
        param("env.TURBO_TEAM", "pekay23")

        // --- Database (Neon. packages/database uses @prisma/adapter-neon, which
        //     speaks SQL-over-HTTP, so a local postgres container cannot serve it.) ---
        param("env.DATABASE_URL", password("SET_IN_TEAMCITY"))
        param("env.DIRECT_URL", password("SET_IN_TEAMCITY"))
        param("env.SUPABASE_DATABASE_URL", password("SET_IN_TEAMCITY"))

        // --- Auth ---
        // NEXTAUTH_SECRET signs the portal's sessions; PLATFORM_SESSION_SECRET
        // signs the super-admin console's (apps/super-admin/lib/admin-auth.ts).
        // It is a password parameter rather than plain text so TeamCity masks it
        // in build logs, and it is listed in turbo.json's globalEnv because turbo
        // strips undeclared variables from every task environment -- and a
        // stripped variable is indistinguishable from an unset one, which for
        // this one means adminAuthConfigured() silently reports false.
        param("env.NEXTAUTH_SECRET", password("SET_IN_TEAMCITY"))
        param("env.NEXTAUTH_URL", "http://localhost:3000")
        param("env.PLATFORM_SESSION_SECRET", password("SET_IN_TEAMCITY"))

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
        // The cross-tenant operator console. Without this the deploy step added for
        // super-admin is skipped, so the app would build in CI and ship nowhere.
        param("env.VERCEL_PROJECT_ID_SUPER_ADMIN", "SET_IN_TEAMCITY")

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
        snapshot(Install) {
            // ANY: a newer commit that passes lint should not be blocked
            // waiting for the previous commit's build to finish.
            reuseBuilds = ReuseBuilds.ANY
        }
    }

    steps {
        script {
            name = "Lint, typecheck, test"
            scriptContent = "bun run ci:verify"
        }
    }

    triggers {
        finishBuildTrigger {
            buildType = Install
            successfulOnly = true
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
        snapshot(Verify) {
            reuseBuilds = ReuseBuilds.ANY
        }
    }

    params {
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
        finishBuildTrigger {
            buildType = Verify
            successfulOnly = true
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
        snapshot(E2ETest) {
            reuseBuilds = ReuseBuilds.ANY
        }
    }

    steps {
        script {
            name = "Build images"
            scriptContent = "bun run ci:docker"
        }
    }

    triggers {
        finishBuildTrigger {
            buildType = E2ETest
            successfulOnly = true
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
        snapshot(DockerBuild) {
            reuseBuilds = ReuseBuilds.NO
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
        finishBuildTrigger {
            buildType = DockerBuild
            successfulOnly = true
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
        snapshot(E2ETest) {
            reuseBuilds = ReuseBuilds.NO
        }
    }

    params {
        param("env.VERCEL_TARGET", "preview")
    }

    steps {
        script {
            name = "vercel pull / build / deploy --prebuilt"
            scriptContent = "bun run ci:deploy"
        }
    }

    triggers {
        finishBuildTrigger {
            buildType = E2ETest
            successfulOnly = true
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
        snapshot(E2ETest) {
            reuseBuilds = ReuseBuilds.NO
        }
    }

    params {
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