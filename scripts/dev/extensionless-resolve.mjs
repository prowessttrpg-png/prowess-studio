// Developer-only Node resolve hook (PAS-10 M3-WO9). The compiled @prowess/db output imports Prisma's generated client,
// which uses extensionless relative specifiers (fine for the bundlers the app and tests use, not for plain Node ESM).
// This hook retries such a relative specifier with ".js" — nothing else is changed. Used only by developer scripts.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && /^\.{1,2}\//.test(specifier) && !/\.[cm]?js$/.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}
