/**
 * The package's `main` entry. A re-export, not a copy: the definitions live in
 * `./types` and this file exists only so `import — from '@novastar/shared-types'`
 * resolves. A second copy here is exactly the drift this replaced — editing a
 * schema in one file while the other kept the old shape.
 */
export * from './types'
