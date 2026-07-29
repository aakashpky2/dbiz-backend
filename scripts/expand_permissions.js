const fs = require('fs');
const path = require('path');

const permissionsMap = {
    'clients.js': 'MANAGE_CLIENTS',
    'departments.js': 'MANAGE_DEPARTMENTS',
    'teams.js': 'MANAGE_TEAMS',
    'admin.js': 'MANAGE_USERS',
    'company-settings.js': 'MANAGE_SETTINGS'
};

const routesDir = path.join(__dirname, '../routes');

for (const [filename, permission] of Object.entries(permissionsMap)) {
    const filePath = path.join(routesDir, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filename}`);
        continue;
    }

    let content = fs.readFileSync(filePath, 'utf-8');

    // Add requirePermission import if not present
    if (!content.includes('requirePermission')) {
        // Special case for files that don't match the standard regex easily, 
        // we'll just insert it at the top after router
        content = content.replace(
            /(const router = express\.Router\(\);)/,
            `$1\nconst { requirePermission } = require('../lib/permissions');`
        );
    }

    const lines = content.split('\n');
    let protectedCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip endpoints that are already protected or use custom logic inside
        if (line.includes('requirePermission') || line.includes('authenticateToken') || line.includes('deprecateHandler')) {
            continue;
        }

        // Skip specific self-serve or open routes
        if (line.includes("('/punch'") || line.includes("('/me'") || line.includes("('/heartbeat'")) {
            continue;
        }

        const regex = /^(router\.(?:post|put|patch|delete)\s*\(\s*['"][^'"]+['"]\s*,\s*)(async\s*\(req,\s*res\)|req,\s*res\s*=>|\(req,\s*res\)\s*=>)/;
        
        if (regex.test(line)) {
            lines[i] = line.replace(regex, `$1requirePermission('${permission}'), $2`);
            protectedCount++;
        }
    }

    if (protectedCount > 0) {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        console.log(`Updated ${filename}: Added protection to ${protectedCount} endpoints with ${permission}`);
    } else {
        console.log(`Skipped ${filename}: No changes needed or already protected.`);
    }
}
