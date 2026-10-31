const { post } = require('../utils/request');

/**
 * 通过 wx.cloud.uploadFile 把本地图片直接上传到云开发云存储，
 * 再把云存储返回的 fileID 交给后端做格式校验并存库。
 *
 * 与后端约定：真实字节不上送后端（后端不再落本地磁盘），后端只接收云存储 fileID；
 * fileID 即图片访问地址，小程序 <image> 可直接以 cloud:// fileID 渲染，无需临时链接。
 * 用法对齐其他项目的 uploadFiles：以 folder 做命名空间隔离（如 'avatars' / 'stalls' / 'feedback'）。
 *
 * @param {string} filePath  wx.chooseMedia 返回的本地临时路径
 * @param {string} [folder]  云存储目录，默认 media
 * @returns {Promise<string>} 云存储 fileID
 */
function uploadImage(filePath, folder = 'media') {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.uploadFile) {
      reject(new Error('当前环境不支持云开发上传，请确认 wx.cloud 已在 app.js 中初始化'));
      return;
    }

    const ext = (filePath.split('.').pop() || 'jpg').toLowerCase();
    const cloudPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;

    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: async (res) => {
        try {
          // 后端仅做 fileID 格式校验并原样回传，便于统一在容器内收敛图片来源。
          const r = await post('/api/v2/media/images', { fileID: res.fileID });
          resolve(r.data.url);
        } catch (e) {
          reject(e);
        }
      },
      fail: (e) => reject(e),
    });
  });
}

module.exports = { uploadImage };
