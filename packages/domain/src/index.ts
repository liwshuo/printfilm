/**
 * @dramaflow/domain — entity types, enums, JSON structures, API contracts,
 * error envelope, repository ports, zod schemas, and pure derivations.
 *
 * This package has no UI / provider / DB dependency (repo-structure §6).
 * It is the single source of truth for shapes described in data-and-api-v1.md §6.
 */

export * from "./primitives.js";
export * from "./enums.js";
export * from "./content-types.js";
export * from "./json-fields.js";
export * from "./entities.js";
export * from "./contracts.js";
export * from "./errors.js";
export * from "./repositories.js";
export * from "./schemas.js";
export * from "./derivations.js";
