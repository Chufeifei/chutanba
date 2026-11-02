const express = require('express');
const attachRequestId = require('./middlewares/request-id');
const { attachIdentity } = require('./middlewares/auth');
const routes = require('./routes');
const notFound = require('./middlewares/not-found');
const errorHandler = require('./middlewares/error-handler');

const app = express();

// requestId 必须最先挂载：后续中间件、业务响应与错误信封都要带上它。
app.use(attachRequestId);

// 一期只接收纯文字业务载荷，按文字资料收紧体积上限，不沿用旧的图片上传范围。
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// 可信身份边界：每个请求都先解析并挂载可信身份（可能为 null），
// 资源级授权由各业务模块在此之上自行校验。
app.use(attachIdentity);

// 业务路由按模块接入后在 routes/index.js 注册，挂载位置必须在此处、404 之前。
// 注：上传的图片由小程序端经 wx.cloud.uploadFile 直传云存储，后端只接收云存储 fileID，
// 不在此托管本地静态目录，避免容器以非 root 用户启动时创建上传目录导致 EACCES 崩溃，
// 也避免 Pod 重启/多副本时本地图片丢失。404 与错误处理中间件必须放在正常路由之后。
app.use('/api/v2', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
