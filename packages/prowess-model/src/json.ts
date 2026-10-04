/**
 * A framework-independent, structurally JSON-compatible value — no Prisma
 * `Json` type leaks into `@prowess/model` (PAS-10 M1-WO6 §11). Used for
 * `EntityRelationship.metadata`; reusable by any future domain type that
 * needs a loosely-structured, serializable value without depending on a
 * specific persistence layer's representation of one.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The specific shape `EntityRelationship.metadata` and similar
 * object-shaped metadata fields use — a JSON *object*, not any JSON value
 * (a bare string or array isn't "metadata" in the sense this platform
 * means it).
 */
export type JsonObject = { [key: string]: JsonValue };
