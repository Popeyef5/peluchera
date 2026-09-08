// Stub target for Turbopack's resolveAlias (see next.config.ts).
//
// Deliberately CommonJS, and deliberately not .ts. Turbopack has no equivalent
// of webpack's IgnorePlugin, so modules we do not want bundled are aliased
// here instead — but the code importing them uses NAMED imports, and Turbopack
// resolves named exports statically against an ESM target and errors when they
// are missing. A CJS module goes through interop instead, so the names resolve
// to undefined at runtime rather than failing the build. That matches what
// IgnorePlugin does on the webpack side: the import resolves, and the code
// paths that would touch it are ones we never take.
module.exports = {};
