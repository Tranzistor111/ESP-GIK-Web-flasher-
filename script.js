const FIRMWARE_FILES = [
    {
        path: "sketch_aug15a.ino.bootloader.bin",
        address: 0x0000,
        name: 'Bootloader'
    },
    {
        path: "sketch_aug15a.ino.partitions.bin",
        address: 0x8000,
        name: 'Partitions'
    },
    {
        path: "sketch_aug15a.ino.bin",
        address: 0x10000,
        name: 'Firmware'
    }
];

const connectBtn = document.getElementById('connectBtn');
const flashBtn = document.getElementById('flashBtn');
const statusDiv = document.getElementById('status');
const connectScreen = document.getElementById('connectScreen');
const flashScreen = document.getElementById('flashScreen');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const progressDetails = document.getElementById('progressDetails');
const fileList = document.getElementById('fileList');

let port = null;
let firmwareData = {};

function displayFileList() {
    fileList.innerHTML = FIRMWARE_FILES.map(file => `
        <div class="file-item">
            <span class="file-item-name">${file.name}</span>
            <span class="file-item-path">${file.path}</span>
            <span class="file-item-address">0x${file.address.toString(16).toUpperCase()}</span>
        </div>
    `).join('');
}
displayFileList();

connectBtn.addEventListener('click', async () => {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        
        statusDiv.textContent = '✓ Подключено к устройству';
        statusDiv.className = 'status connected';
        connectScreen.style.display = 'none';
        flashScreen.style.display = 'flex';
        
        await loadAllFirmwareFiles();
        
    } catch (error) {
        if (error.name !== 'NotFoundError') {
            statusDiv.textContent = `✗ Ошибка: ${error.message}`;
            statusDiv.className = 'status error';
        }
    }
});

async function loadAllFirmwareFiles() {
    statusDiv.textContent = 'Загрузка файлов прошивки...';
    statusDiv.className = 'status progress';
    
    try {
        const results = await Promise.allSettled(
            FIRMWARE_FILES.map(file => loadFile(file))
        );
        
        let loadedCount = 0;
        const missingFiles = [];
        
        FIRMWARE_FILES.forEach((file, index) => {
            if (results[index].status === 'fulfilled') {
                firmwareData[file.name] = {
                    data: results[index].value,
                    address: file.address
                };
                loadedCount++;
                console.log(`${file.name}: ${results[index].value.length} байт загружено`);
            } else {
                missingFiles.push(file.name);
                console.warn(`Не удалось загрузить ${file.name}:`, results[index].reason);
            }
        });
        
        if (loadedCount === FIRMWARE_FILES.length) {
            statusDiv.textContent = '✓ Файлы прошивки загружены';
            statusDiv.className = 'status connected';
        } else if (loadedCount > 0) {
            statusDiv.textContent = `⚠ Загружено ${loadedCount} из ${FIRMWARE_FILES.length} файлов`;
            statusDiv.className = 'status progress';
            console.log('Отсутствующие файлы:', missingFiles);
        } else {
            statusDiv.textContent = '✗ Файлы прошивки не найдены. Проверьте, что они загружены в репозиторий';
            statusDiv.className = 'status error';
            console.error('Все файлы отсутствуют. Список файлов:', missingFiles);
        }
        
    } catch (error) {
        statusDiv.textContent = `✗ Ошибка загрузки: ${error.message}`;
        statusDiv.className = 'status error';
    }
}

async function loadFile(fileConfig) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        const cleanPath = fileConfig.path.replace('./', '');
        
        console.log(`Загрузка файла: ${cleanPath}`);
        
        xhr.open('GET', cleanPath, true);
        xhr.responseType = 'arraybuffer';
        
        xhr.onload = () => {
            console.log(`Статус загрузки ${cleanPath}:`, xhr.status);
            
            if (xhr.status === 200) {
                const uint8Array = new Uint8Array(xhr.response);
                console.log(`Файл ${cleanPath} загружен: ${uint8Array.length} байт`);
                resolve(uint8Array);
            } else {
                console.error(`Ошибка загрузки ${cleanPath}: статус ${xhr.status}`);
                reject(new Error(`Файл ${cleanPath} не найден (ошибка ${xhr.status})`));
            }
        };
        
        xhr.onerror = () => {
            console.error(`Ошибка сети при загрузке ${cleanPath}`);
            reject(new Error(`Не удалось загрузить ${cleanPath}. Проверьте, что файл существует в репозитории`));
        };
        
        xhr.ontimeout = () => {
            console.error(`Таймаут при загрузке ${cleanPath}`);
            reject(new Error(`Таймаут при загрузке ${cleanPath}`));
        };
        
        xhr.timeout = 10000; 
        xhr.send();
    });
}

function updateProgress(percent, details = '') {
    progressFill.style.width = percent + '%';
    progressText.textContent = percent + '%';
    if (details) progressDetails.textContent = details;
}

flashBtn.addEventListener('click', async () => {
    if (Object.keys(firmwareData).length === 0) {
        statusDiv.textContent = '✗ Сначала загрузите файлы прошивки';
        statusDiv.className = 'status error';
        return;
    }
    
    try {
        flashBtn.disabled = true;
        progressContainer.style.display = 'block';
        updateProgress(0);
        statusDiv.className = 'status progress';

        statusDiv.textContent = 'Синхронизация...';
        updateProgress(5, 'Синхронизация с ESP32-S3');
        await syncESP32();
        
        const fileNames = Object.keys(firmwareData);
        let totalFiles = fileNames.length;
        
        for (let i = 0; i < totalFiles; i++) {
            const name = fileNames[i];
            const fileInfo = firmwareData[name];
            
            const startPercent = 10 + (i * (85 / totalFiles));
            const endPercent = 10 + ((i + 1) * (85 / totalFiles));
            
            statusDiv.textContent = `Прошивка ${name}...`;
            await flashData(fileInfo.data, fileInfo.address, (progress) => {
                const total = Math.round(startPercent + (progress * (endPercent - startPercent) / 100));
                updateProgress(total, `${name}: ${Math.round(progress)}%`);
            });
        }

        updateProgress(100, 'Перезагрузка...');
        statusDiv.textContent = '✓ Прошивка завершена!';
        statusDiv.className = 'status connected';
        await resetESP32();
        
    } catch (error) {
        statusDiv.textContent = `✗ Ошибка: ${error.message}`;
        statusDiv.className = 'status error';
        console.error(error);
    } finally {
        flashBtn.disabled = false;
        setTimeout(() => updateProgress(0), 3000);
    }
});

async function syncESP32() {
    const writer = port.writable.getWriter();
    const SYNC = new Uint8Array([
        0xC0, 0x00, 0x08, 0x24, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x07, 0x12, 0x20, 0xC0
    ]);
    
    for (let i = 0; i < 10; i++) {
        await writer.write(SYNC);
        await new Promise(r => setTimeout(r, 50));
    }
    writer.releaseLock();
}

async function flashData(data, address, progressCallback) {
    const writer = port.writable.getWriter();
    const packetSize = 4096;
    let offset = 0;
    
    const flashBegin = slipEncode(new Uint8Array([
        0x00, 0x06, 0x24, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00
    ]));
    await writer.write(flashBegin);
    
    while (offset < data.length) {
        const chunk = data.slice(offset, Math.min(offset + packetSize, data.length));
        const cmd = buildFlashPacket(chunk, address + offset);
        const packet = slipEncode(cmd);
        await writer.write(packet);
        
        offset += chunk.length;
        const percent = Math.round((offset / data.length) * 100);
        progressCallback(Math.min(percent, 100));
        
        await new Promise(r => setTimeout(r, 10));
    }
    
    writer.releaseLock();
}

function slipEncode(data) {
    const result = [0xC0];
    for (let i = 0; i < data.length; i++) {
        const b = data[i];
        if (b === 0xC0) { result.push(0xDB, 0xDC); }
        else if (b === 0xDB) { result.push(0xDB, 0xDD); }
        else { result.push(b); }
    }
    result.push(0xC0);
    return new Uint8Array(result);
}

function buildFlashPacket(data, address) {
    const totalSize = 16 + data.length + 2;
    const cmd = new Uint8Array(totalSize);
    cmd[0] = 0x00;
    cmd[1] = 0x03;
    cmd[2] = (totalSize - 8) & 0xFF;
    cmd[3] = ((totalSize - 8) >> 8) & 0xFF;
    cmd[4] = 0x00;
    cmd[5] = 0x00;
    cmd[6] = 0x00;
    cmd[7] = 0x00;
    cmd[8] = (totalSize - 16) & 0xFF;
    cmd[9] = ((totalSize - 16) >> 8) & 0xFF;
    cmd[10] = ((totalSize - 16) >> 16) & 0xFF;
    cmd[11] = ((totalSize - 16) >> 24) & 0xFF;
    cmd[12] = 0x00;
    cmd[13] = 0x00;
    cmd[14] = 0x00;
    cmd[15] = 0x00;
    
    cmd.set(data, 16);
    
    let checksum = 0xEF;
    for (let i = 0; i < totalSize - 2; i++) {
        checksum ^= cmd[i];
    }
    cmd[totalSize - 2] = checksum;
    cmd[totalSize - 1] = 0x00;
    
    return cmd;
}

async function resetESP32() {
    try {
        await port.setSignals({ dataTerminalReady: false, requestToSend: true });
        await new Promise(r => setTimeout(r, 100));
        await port.setSignals({ dataTerminalReady: true, requestToSend: false });
    } catch (e) {
        console.log('Сброс не удался:', e.message);
    }
}

navigator.serial.addEventListener('disconnect', () => {
    port = null;
    firmwareData = {};
    flashScreen.style.display = 'none';
    connectScreen.style.display = 'block';
    progressContainer.style.display = 'none';
    updateProgress(0);
    statusDiv.textContent = '✗ Устройство отключено';
    statusDiv.className = 'status error';
    console.log('Устройство отключено');
});
