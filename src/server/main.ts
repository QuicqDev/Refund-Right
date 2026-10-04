import { resolve } from 'node:path';
import express from 'express';
import { runtime } from './runtime.ts';
import { createApp } from './http.ts';
import { config } from './config.ts';
const { workflow, checkout } = runtime();
const app = createApp(workflow, checkout, { password: config.operatorPassword, sandboxReady: !!(config.paypalClientId && config.paypalSecret && config.merchantId) });
app.use(express.static(resolve('dist')));
app.listen(4331, '127.0.0.1', () => console.log('Refund Right API: http://127.0.0.1:4331 · local sandbox workspace'));
