# 3D / WebGL 作品集

用 three.js 手写几何体构建的模型与场景，**全部可在浏览器中直接运行**，无需安装、无需后端。

## 在线访问

**<https://selieri596.github.io/pages-gallery/>**

## 收录内容

| 项目 | 入口 | 说明 |
|---|---|---|
| AH-64E 阿帕奇武装直升机 | [`ah-64e/index.html`](ah-64e/index.html) | three.js 程序化几何重建，单文件自包含（707 KB），含主旋翼、尾桨、短翼挂载点与起落架 |
| EVA-01 初号机 | [`eva-01/viewer.html`](eva-01/viewer.html) | 依据 1995 TV 版设定资料重建的 EVA-01，交互式 360° 查看器，模型数据内嵌于页面 |
| 花 · 交互场景 | [`flower/index.html`](flower/index.html) | 向陈星汉《花》致敬的网页 3D 场景，全程序化生成，含 17 万株实例化草叶、体积云与云影投地 |

## 结构

```
pages-gallery/
├── index.html            作品集首页（导航卡片）
├── ah-64e/
│   └── index.html        自包含场景（three.js + 模型数据全部内联）
├── eva-01/
│   ├── viewer.html       查看器（GLB 模型数据内嵌）
│   └── three.min.js      依赖
└── flower/
    ├── index.html        场景入口
    ├── game.js           场景逻辑
    └── libs/three.min.js 依赖
```

> 本仓库只托管**可公开访问的演示产物**。
> 各项目的完整源码（构建脚本、参考素材、调试工具）分别在独立的私有仓库中。

## 部署

本仓库通过 **GitHub Pages** 发布，来源为 `main` 分支根目录。
推送后自动重新构建，通常 1 分钟内生效。

## 许可

各子项目的版权与致谢见对应源仓库的 README。
《新世纪福音战士》相关版权归 khara 所有；《花》(flower) 相关版权归 thatgamecompany 所有。
本项目仅用于学习与技术演示。
