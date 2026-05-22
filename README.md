## 说明
仓库存放适用于 Windows 和 Linux 系统的鼠标指针，使用 [Ani2xcur CLI](https://github.com/licyk/ani2xcur-cli) 进行格式转换。

- [`windows`](windows/) 文件夹存放适用于 Windows 的鼠标指针文件。
- [`linux`](linux/)文件夹存放适用于 Linux 的鼠标指针文件。

## 部署到子路径

如果网站不是部署在域名根目录，而是类似 `/cursors-archive/` 这样的子路径下，构建时需要指定 `VITE_BASE_PATH`：

```bash
VITE_BASE_PATH=/cursors-archive/ bun run build
```

该路径会同时用于页面资源、预览图和下载链接。

*鼠标指针收集于网络。*
