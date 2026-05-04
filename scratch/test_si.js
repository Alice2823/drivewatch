const si = require('systeminformation');

async function test() {
    console.log('Fetching CPU Temperature...');
    try {
        const temp = await si.cpuTemperature();
        console.log('CPU Temp:', JSON.stringify(temp, null, 2));
    } catch (err) {
        console.error('Error fetching CPU Temp:', err);
    }

    console.log('\nFetching GPU Info...');
    try {
        const gpu = await si.graphics();
        console.log('GPU Info:', JSON.stringify(gpu, null, 2));
    } catch (err) {
        console.error('Error fetching GPU Info:', err);
    }
}

test();
