const { exec } = require('child_process');
const path = require('path');

function getFolderSize(dirPath) {
    return new Promise((resolve) => {
        const start = Date.now();
        // /L = List only, /S = Subdirectories, /NJH = No Job Header, /NJS = No Job Summary, /BYTES = Sizes in bytes, /XJ = Exclude Junctions
        const cmd = `robocopy "${dirPath}" NULL /L /S /NJH /NJS /BYTES /XJ /NC /NDL /NFL /R:0 /W:0`;
        
        exec(cmd, (error, stdout) => {
            const end = Date.now();
            // Robocopy output summary is typically at the end if we don't suppress it, 
            // but with /NJH /NJS it might be tricky.
            // Let's try WITHOUT /NJH /NJS first to see the summary table.
            const fullCmd = `robocopy "${dirPath}" NULL /L /S /XJ /BYTES /R:0 /W:0`;
            exec(fullCmd, (err, out) => {
                const match = out.match(/Bytes\s+:\s+(\d+)/);
                const size = match ? parseInt(match[1]) : 0;
                resolve({ size, duration: end - start });
            });
        });
    });
}

// Test on a common folder
const testPath = 'C:\\Program Files';
getFolderSize(testPath).then(res => {
    console.log(`Folder: ${testPath}`);
    console.log(`Size: ${res.size} bytes (${(res.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`Duration: ${res.duration}ms`);
});
