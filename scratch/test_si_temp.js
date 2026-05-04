const si = require('systeminformation');
si.cpuTemperature().then(data => console.log(JSON.stringify(data))).catch(err => console.error(err));
