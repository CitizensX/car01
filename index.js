// 全局变量
let client_id, client_secret, user_name, user_password;
let device_name, device_id, device_key, device_LockSignalValue, device_VoltageDataInterface, device_TemperatureDataInterface, device_HumidityDataInterface, device_LockDataInterface, device_StartDataInterface, device_WindowDataInterface;
let db;

// BLE 相关变量
let bleDevice;
let bleServer;
let bleService;
let bleCharacteristic;
let rssiInterval;
let carStatus;
let lastStatusTime;
let statusTimeout = 10000;
let voltage = 0.00;
let temperature = 0.00;
let humidity = 0.00;
let deviceStatusSource = null;
let networkConnected = false;
let bluetoothConnected = false;
let statusTimeoutTimer;

// 获取页面元素
const lockButton = document.getElementById('lock-button');
const startButton = document.getElementById('start-button');
const trunkButton = document.getElementById('trunk-button');
const findCarButton = document.getElementById('find-car-button');
const windowButton = document.getElementById('window-button');
const voltageDisplay = document.getElementById('voltage');
const temperatureDisplay = document.getElementById('temperature');
const humidityDisplay = document.getElementById('humidity');
const carImage = document.getElementById('car-image');
const deviceNameDisplay = document.getElementById('device-name'); // 获取设备名称显示元素
const debugOutput = document.querySelector('.debug-output');
const timeDisplay = document.querySelector('.time-display');
const offlineAlert = document.getElementById('offline-alert');
const successAlert = document.getElementById('success-alert');
let isDebugVisible = false;
let shouldAutoScroll = true;

let lastDataTime = Date.now();
let isConnected = false;
let ws;
let deviceCheckInterval; // 定时器变量
let reconnectInterval; // 重连定时器变量
const RECONNECT_DELAY = 1000; // 重连延迟时间，单位：毫秒

// 定时器相关变量
let timer;
let elapsedTime = 0;
let isTimeVisible = true;

// 定时器变量，分别用于离线提醒和成功提醒
let offlineAlertTimer;
let successAlertTimer;

// 打开 IndexedDB 数据库
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('DeviceImagesDB', 1);

        request.onupgradeneeded = function (event) {
            db = event.target.result;
            const objectStore = db.createObjectStore('DeviceImages', { keyPath: 'deviceName' });
        };

        request.onsuccess = function (event) {
            db = event.target.result;
            resolve();
        };

        request.onerror = function (event) {
            console.error('IndexedDB 打开失败:', event.target.error);
            reject(event.target.error);
        };
    });
}

// 从 IndexedDB 获取设备图片
function getDeviceImage(deviceName, callback) {
    if (!db) {
        console.error('IndexedDB 数据库未打开');
        callback(null);
        return;
    }
    const transaction = db.transaction(['DeviceImages']);
    const objectStore = transaction.objectStore('DeviceImages');
    const request = objectStore.get(deviceName);

    request.onsuccess = function () {
        const result = request.result;
        if (result) {
            callback(result.imageData);
        } else {
            callback(null);
        }
    };

    request.onerror = function (event) {
        console.error('设备图片获取失败:', event.target.error);
        callback(null);
    };
}

// 调试输出函数
function debugLog(message) {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logEntry = document.createElement('p');
    logEntry.textContent = `${time} ${message}`;
    debugOutput.appendChild(logEntry);

    // 添加小的阈值来判断是否滚动到底部
    const threshold = 5;
    const isAtBottom = debugOutput.scrollTop + debugOutput.clientHeight >= debugOutput.scrollHeight - threshold;
    if (isAtBottom) {
        shouldAutoScroll = true;
    }

    if (shouldAutoScroll) {
        debugOutput.scrollTop = debugOutput.scrollHeight;
    }
}

// 检查配置文件并读取内容
async function checkConfigFiles() {
    try {
        await openDatabase();
        const deviceConfigS = localStorage.getItem('DeviceConfigS');
        console.log(`DeviceConfigS: ${deviceConfigS}`);
        const deviceConfig = localStorage.getItem('DeviceConfig');
        console.log(`DeviceConfig: ${deviceConfig}`);
        const userConfig = localStorage.getItem('UserConfig');
        console.log(`UserConfig: ${userConfig}`);

        if (!deviceConfig || !userConfig) {
            window.location.href = 'config.html';
            return;
        }

        try {
            const userData = JSON.parse(userConfig);
            client_id = userData.client_id;
            client_secret = userData.client_secret;
            user_name = userData.user_name;
            user_password = userData.user_password;

            if (!client_id || !client_secret || !user_password || !user_password) {
                window.location.href = 'config.html';
                return;
            }
        } catch (error) {
            window.location.href = 'config.html';
            return;
        }

        try {
            const deviceData = JSON.parse(deviceConfig);
            device_name = deviceData.device_name;
            device_id = deviceData.device_id;
            device_key = deviceData.device_key;
            device_LockSignalValue = deviceData.device_LockSignalValue;
            device_VoltageDataInterface = deviceData.device_VoltageDataInterface;
            device_TemperatureDataInterface = deviceData.device_TemperatureDataInterface;
            device_HumidityDataInterface = deviceData.device_HumidityDataInterface;
            device_LockDataInterface = deviceData.device_LockDataInterface;
            device_StartDataInterface = deviceData.device_StartDataInterface;
            device_WindowDataInterface = deviceData.device_WindowDataInterface;

            if (!device_name || !device_id || !device_key) {
                window.location.href = 'config.html';
                return;
            }
        } catch (error) {
            window.location.href = 'config.html';
            return;
        }

        // 设置设备名称
        if (deviceNameDisplay) {
            deviceNameDisplay.textContent = device_name;
        }

        // 设置汽车图片
        setCarImage();

        // 连接 WebSocket
        connectWebSocket();
    } catch (error) {
        console.error('打开 IndexedDB 数据库时出错:', error);
    }
}

// 设置汽车图片
function setCarImage() {
    getDeviceImage(device_name, (imageData) => {
        if (imageData) {
            carImage.src = imageData;
            carImage.onerror = function () {
                // 图片加载失败时重试
                setTimeout(() => {
                    setCarImage();
                }, 3000);
            };
        } else {
            carImage.style.display = 'none';
        }
        // 根据图片大小设置调试框大小
        setTimeout(() => {
            debugOutput.style.width = carImage.offsetWidth + 'px';
            debugOutput.style.height = carImage.offsetHeight + 'px';
            timeDisplay.style.left = carImage.offsetLeft + 'px';
            timeDisplay.style.top = carImage.offsetTop + carImage.offsetHeight - timeDisplay.offsetHeight + 'px';
        }, 0);
    });
}

// WebSocket 连接
function connectWebSocket() {
    ws = new WebSocket('wss://www.bigiot.net:8484');
    ws.onopen = () => {
        debugLog('WebSocket 已连接');
        clearInterval(reconnectInterval); // 连接成功，清除重连定时器
    };
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log(`服务器数据: ${JSON.stringify(data)}`);
        if (data.M === 'WELCOME TO BIGIOT') {
            login();
        } else if (data.M === 'loginok') {
            // 每 3 秒发送沟通指令数据
            setInterval(() => SendSayData("00"), 3000);
            SendSayData("00");
            debugLog('WebSocket 登录成功');
        } else if (data.M === 'say' && data.ID === `D${device_id}` && data.SIGN === 'S') {
            parseDeviceResponse(data.C);
        }
    };
    ws.onclose = () => {
        debugLog('WebSocket 已断开，尝试重连...');
        isConnected = false;
        clearInterval(deviceCheckInterval);
        deviceCheckInterval = null;
        // 启动重连定时器
        reconnectInterval = setInterval(() => {
            connectWebSocket();
        }, RECONNECT_DELAY);
    };
    ws.onerror = (error) => {
        debugLog(`WebSocket 连接错误: ${error}`);
        isConnected = false;
        clearInterval(reconnectInterval); // 清除重连定时器
    };
}

// 用户登录
function login() {
    const loginData = JSON.stringify({
        M: 'login',
        ID: user_name,
        K: user_password
    });
    console.log(`login: ${loginData}`);
    ws.send(loginData);
}

// 发送沟通指令数据
function SendSayData(data) {
    const SendData = JSON.stringify({
        M: 'say',
        ID: `D${device_id}`,
        C: data
    });
    if (ws.readyState === WebSocket.OPEN) {
        console.log(`SendData: ${SendData}`);
        ws.send(SendData);
    }
}

// 解析设备返回数据
function parseDeviceResponse(response) {
    isConnected = true;

    if (!deviceCheckInterval) {
        // 开启设备状态检查（每 15 秒检查设备连接状态）
        deviceCheckInterval = setInterval(checkDeviceConnection, 15000);
    }

    const [
        lockState,
        engineState,
        trunkState,
        findCarState,
        windowState,
        voltage,
        temperature,
        humidity
    ] = response.split(',');

    updateButtonState(lockButton, lockState, '解锁', '锁定', '#202020', '#4CAF50');
    updateButtonState(startButton, engineState, '启动引擎', '关闭引擎', '#202020', '#4CAF50', '#007BFF');
    updateButtonState(trunkButton, trunkState, '打开尾箱', '关闭尾箱', '#202020', '#4CAF50');
    updateButtonState(findCarButton, findCarState, '寻车', '关闭寻车', '#202020', '#4CAF50');
    updateButtonState(windowButton, windowState, '开窗', '关窗', '#202020', '#4CAF50');

    voltageDisplay.textContent = parseFloat(voltage).toFixed(2);
    temperatureDisplay.textContent = parseFloat(temperature).toFixed(2);
    humidityDisplay.textContent = parseFloat(humidity).toFixed(2);

    lastDataTime = Date.now();

    // 重置定时器
    clearInterval(timer);
    elapsedTime = 0;
    timer = setInterval(() => {
        elapsedTime += 0.1;
        timeDisplay.textContent = elapsedTime.toFixed(1) + 's';
    }, 100);
}

// 更新按钮状态
function updateButtonState(button, state, text1, text2, color1, color2, specialColor) {
    if (state === '0') {
        button.textContent = text1;
        button.style.backgroundColor = color1;
    } else if (state === '2' && specialColor) {
        button.textContent = text2;
        button.style.backgroundColor = specialColor;
    } else {
        button.textContent = text2;
        button.style.backgroundColor = color2;
    }
}

// 检查设备连接状态
function checkDeviceConnection() {
    if (Date.now() - lastDataTime > 15000) {
        isConnected = false;
        debugLog('状态超时');
    }
}

// 启动 BLE
async function startBluetooth() {
    try {
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: ['00FF'] }]
        });
        bleServer = await bleDevice.gatt.connect();
        bleService = await bleServer.getPrimaryService('00FF');
        bleCharacteristic = await bleService.getCharacteristic('FF01');

        // 连接成功后设置标志
        bluetoothConnected = true;
        debugLog('蓝牙连接成功');

        // 开始 RSSI 监测
        rssiInterval = setInterval(async () => {
            try {
                const rssi = await bleDevice.gatt.readRemoteRssi();
                debugLog(`RSSI: ${rssi}`);
            } catch (error) {
                debugLog(`读取 RSSI 时出错: ${error}`);
            }
        }, 5000);

        // 监听特征值变化
        await bleCharacteristic.startNotifications();
        bleCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            const value = event.target.value;
            // 处理特征值变化
            debugLog(`特征值变化: ${value}`);
        });
    } catch (error) {
        debugLog(`蓝牙连接失败: ${error}`);
    }
}

// 创建不可见按钮并在页面加载时触发点击
window.onload = async function () {
    try {
        debugLog('V 25.04.25.1');
        await checkConfigFiles();
        isConnected = false;
        debugOutput.style.display = 'none';
        // 启动定时器
        timer = setInterval(() => {
            elapsedTime += 0.1;
            timeDisplay.textContent = elapsedTime.toFixed(1) + 's';
        }, 100);

        // 创建不可见按钮
        const invisibleButton = document.createElement('button');
        invisibleButton.style.display = 'none';
        invisibleButton.addEventListener('click', startBluetooth);
        document.body.appendChild(invisibleButton);

        // 自动触发点击事件
        invisibleButton.click();
    } catch (error) {
        console.error('页面加载时出错:', error);
    }
};    