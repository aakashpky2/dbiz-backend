const routeManifest = require('../config/route-manifest');

console.log('[StartupCheck] Validating route imports...');

let hasError = false;

for (const definition of routeManifest) {
    try {
        console.log(`[StartupCheck] Loading ${definition.name} from ${definition.modulePath}`);
        const loadedModule = require(definition.modulePath);
        
        const router = definition.exportName
            ? loadedModule[definition.exportName]
            : loadedModule;

        if (!router || typeof router !== "function") {
            throw new TypeError(`Route "${definition.name}" did not export a valid Express router`);
        }
        console.log(`[StartupCheck] Successfully loaded ${definition.name}`);
    } catch (error) {
        console.error(`\n[FATAL] Failed to load route: ${definition.name}`);
        console.error(`Module path: ${definition.modulePath}`);
        console.error(`Error message: ${error.message}`);
        console.error(`Full stack: ${error.stack}\n`);
        hasError = true;
        break; // Stop on first error to prevent cascading failures
    }
}

if (hasError) {
    process.exit(1);
}

console.log("[StartupCheck] All route modules loaded successfully");
process.exit(0);
