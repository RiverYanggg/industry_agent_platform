# 项目主线智能建模与 Agent 编排平台

基于需求文档实现的可运行 MVP，覆盖以下主链路：

- 项目 CRUD、项目级 1:1 知识库、文档上传与 TF-IDF 检索
- 子项目工作台、数据集上传、`scikit-learn` 真实训练运行、运行历史
- 基于数据集列结构配置输入特征 X / 输出目标 Y，并在训练后自动保存模型到子项目
- 已保存模型可直接用于手动上传预测集，或作为 Agent Tool 调用
- 分析图与附件管理，数据上传后自动生成基础可视化，训练成功后自动生成评估图，且支持内联编辑题注与描述
- Agent 会话管理、上下文绑定、会话附件、SSE 工具可视化与终端日志
- Agent 大模型配置面板，可接入 OpenAI 兼容 `/v1/` 代理并驱动工具规划
- OpenAI 兼容 `/v1/chat/completions` 与 `/v1/models`

## 运行方式

在项目根目录创建 `.env`（可复制 `.env.example` 后填入密钥）。服务启动时会自动加载 `.env`（不覆盖已在 shell 中设置的同名变量）。

```bash
python3 -m uvicorn server.main:app --reload
```

## Gradio 托管（Space）

当前仓库已新增 `app.py`，可直接作为 Gradio Space 的入口文件。

本地验证：

```bash
python3 app.py
```

Gradio Space 部署要点：

1. 确保仓库根目录包含 `app.py` 与 `requirements.txt`。
2. `requirements.txt` 已包含 `gradio` 依赖。
3. 推送代码后，平台会自动安装依赖并运行 `app.py`。

打开：

- Web 控制台: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
- 健康检查: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

## 配置 Agent 大模型

方式一：在页面 `API DOCK -> 大模型接入配置` 中填写：

- `Base URL`：例如 `https://<hostname>/v1/`
- `API Key`
- `Model ID`
- `Temperature`

方式二：在 `.env` 或环境变量中设置（推荐 `.env`，已加入 `.gitignore`）：

```bash
AGENT_LLM_ENABLED=true
AGENT_LLM_BASE_URL="https://<hostname>/v1/"
AGENT_LLM_API_KEY="your-key"
AGENT_LLM_MODEL="模型ID"
```

也可在启动命令前临时 `export` 同名变量。

配置成功后：

- Agent 会优先走远程大模型做工具规划与结果总结
- `/v1/chat/completions` 会代理到你配置的上游模型
- 如果未配置或上游失败，Agent 会自动回退到本地启发式策略

## 推荐试跑流程

1. 创建一个项目。
2. 上传 `examples/sensor_regression.csv` 作为训练集。
3. 创建子项目并在子项目中上传同一个 CSV。
4. 选择回归模板，目标列选 `target`，其余列作为特征，启动训练。
5. 训练完成后模型会自动保存到当前子项目。
6. 在 Agent Console 新建会话，绑定同一项目与子项目。
7. 上传预测集并发送“请校验附件并用当前模型做批量预测”。

## 目录说明

- `server/main.py`: FastAPI 后端、SQLite 元数据、训练/预测与 Agent 事件流
- `web/index.html`: 控制台结构
- `web/styles.css`: 工业控制台风格 CSS Tokens 与布局
- `web/app.js`: 前端状态管理与前后端交互
- `examples/sensor_regression.csv`: 可直接上传的样例数据

## 说明

- 存储默认落在 `data/` 目录，包括 SQLite 数据库、上传文件、模型与结果文件。
- 当前 Agent 支持两种模式：远程大模型驱动的工具规划，以及无配置时的本地回退策略。
- 训练与推理支持 `csv/xlsx/xls`，知识库支持 `pdf/txt/md`。
