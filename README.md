# 流星：剑影 v0.2

一个轻量的 3D 网页武侠动作原型，使用 Three.js 和原生 JavaScript。

## 这版更新
- 加入古风庭院、石板地面、屋檐、木柱、红灯笼、树木、雾气和环境灯光。
- 角色增加头发、衣袍、腰带、剑格和剑尖等细节。
- 攻击命中时增加短暂剑光轨迹。
- 保留电脑键盘、手机触屏、敌人 AI、生命/体力条和本地累计胜场。

## 本地预览
请通过本地 HTTP 服务器打开，不要从手机文件管理器直接打开 `index.html`，因为浏览器会限制 ES 模块加载。

可用 VS Code + Live Server；或在项目文件夹运行：
```bash
python -m http.server 8000
```
然后访问 `http://localhost:8000`。

## 发布 GitHub Pages
1. 上传 `index.html`、`README.md` 和 `.nojekyll` 到仓库根目录。
2. GitHub 仓库 → Settings → Pages。
3. 选择 `Deploy from a branch`，分支选 `main`，目录选 `/(root)`，保存。
4. 等部署完成后访问 GitHub Pages 提供的网址。

## 注意
Three.js 通过 jsDelivr CDN 加载，因此首次打开需要网络连接。胜场保存在当前浏览器的 localStorage，不会自动跨设备同步。当前角色为程序生成的简易模型，之后可替换成正式模型和动作动画。
