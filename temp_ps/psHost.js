"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PowerShellHost = void 0;
var child_process_1 = require("child_process");
var crypto_1 = require("crypto");
var PowerShellHost = /** @class */ (function () {
    function PowerShellHost() {
        this.process = null;
        this.commandQueue = [];
        this.currentOutput = '';
        this.isProcessing = false;
        this.startProcess();
    }
    PowerShellHost.getInstance = function (name) {
        if (name === void 0) { name = 'default'; }
        var existing = PowerShellHost.instances.get(name);
        if (existing) {
            return existing;
        }
        var instance = new PowerShellHost();
        PowerShellHost.instances.set(name, instance);
        return instance;
    };
    PowerShellHost.prototype.startProcess = function () {
        var _this = this;
        this.process = (0, child_process_1.spawn)('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '-'
        ], { windowsHide: true });
        this.process.stdout.on('data', function (data) {
            _this.currentOutput += data.toString('utf8');
            _this.checkOutput();
        });
        this.process.stderr.on('data', function (data) {
            // Often PowerShell writes warnings to stderr, we can just ignore them or log them
        });
        this.process.stdin.on('error', function (err) {
            console.error('[PS Host] Stdin error:', err);
            // We don't need to do much here, the 'close' event will handle restart
        });
        this.process.on('close', function () {
            console.warn('[PS Host] Process exited. Restarting...');
            _this.isProcessing = false;
            if (_this.commandQueue.length > 0) {
                var failed = _this.commandQueue.shift();
                failed === null || failed === void 0 ? void 0 : failed.resolve(''); // Resolve empty on crash to prevent hangs
            }
            _this.startProcess();
        });
        // If there were items in queue waiting, start them
        if (this.commandQueue.length > 0) {
            this.processNext();
        }
    };
    PowerShellHost.prototype.checkOutput = function () {
        if (this.commandQueue.length === 0)
            return;
        var currentTask = this.commandQueue[0];
        var endMarker = "__END_".concat(currentTask.id, "__");
        if (this.currentOutput.includes(endMarker)) {
            // Command finished
            var parts = this.currentOutput.split(endMarker);
            var result = parts[0].trim();
            // Sometimes PS prepends the command itself or extra newlines.
            this.currentOutput = parts[1] || '';
            this.commandQueue.shift();
            this.isProcessing = false;
            currentTask.resolve(result);
            this.processNext();
        }
    };
    PowerShellHost.prototype.processNext = function () {
        var _a;
        if (this.isProcessing || this.commandQueue.length === 0 || !this.process)
            return;
        this.isProcessing = true;
        var task = this.commandQueue[0];
        // Write command, then write marker to stdout
        if (this.process.stdin.writable) {
            try {
                this.process.stdin.write("".concat(task.script, "\nWrite-Output \"").concat("__END_".concat(task.id, "__"), "\"\n"));
            }
            catch (err) {
                console.error('[PS Host] Write failed:', err);
                this.isProcessing = false;
                this.commandQueue.shift();
                task.resolve('');
                this.processNext();
            }
        }
        else {
            console.warn('[PS Host] Stdin not writable. Restarting...');
            this.isProcessing = false;
            (_a = this.process) === null || _a === void 0 ? void 0 : _a.kill(); // This will trigger 'close' and restart
        }
    };
    /**
     * Executes a powershell command synchronously (via queue) in the persistent runspace.
     */
    PowerShellHost.prototype.execute = function (script_1) {
        return __awaiter(this, arguments, void 0, function (script, timeoutMs) {
            var _this = this;
            if (timeoutMs === void 0) { timeoutMs = 15000; }
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve) {
                        var id = (0, crypto_1.randomUUID)().replace(/-/g, '');
                        var timer = null;
                        var wrapResolve = function (val) {
                            if (timer)
                                clearTimeout(timer);
                            resolve(val);
                        };
                        var wrapReject = function (err) {
                            if (timer)
                                clearTimeout(timer);
                            resolve(''); // Resolve empty on failure to prevent unhandled app crashes
                        };
                        _this.commandQueue.push({ id: id, script: script, resolve: wrapResolve, reject: wrapReject });
                        if (!_this.isProcessing) {
                            _this.processNext();
                        }
                        timer = setTimeout(function () {
                            var _a;
                            var idx = _this.commandQueue.findIndex(function (q) { return q.id === id; });
                            if (idx !== -1) {
                                _this.commandQueue.splice(idx, 1);
                            }
                            if (_this.isProcessing && idx === 0) {
                                _this.isProcessing = false;
                                // If the active one timed out, the runspace is stuck. Restart it.
                                (_a = _this.process) === null || _a === void 0 ? void 0 : _a.kill();
                            }
                            wrapReject(new Error('Timeout'));
                        }, timeoutMs);
                    })];
            });
        });
    };
    PowerShellHost.instances = new Map();
    return PowerShellHost;
}());
exports.PowerShellHost = PowerShellHost;
