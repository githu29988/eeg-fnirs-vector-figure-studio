# GAT-CMC-Net 异质图融合癫痫检测 · 模块逐讲

> 对应 chart：`src/charts/gat-cmc-overall/index.tsx`
> 在线预览：<https://githu29988.github.io/eeg-fnirs-vector-figure-studio/#/chart/gat-cmc-overall>

整张图分 **3 大段**：

1. ① 单模态图特征提取（EEG + fNIRS 各自做 GAT）
2. ② HRF 感知异质图融合（核心创新：可学习的 HRF 软位移 + 跨模态 GAT + 门控融合）
3. ③ 事件级癫痫解码（BiGRU + 2D-CNN + 事件合并 + LOSO 评估）

下文按列从左到右、行内从上到下依次讲。每个面板都附了"面板文字"、"底部 viz 可视化"、"它在论文里的作用"三段说明。

---

## 1. EEG Input（左上 · 蓝色 · 输入）

**做什么**：原始头皮 EEG 张量进系统的入口。

**面板里的内容**：

- $\mathbf{X}^E \in \mathbb{R}^{N_E \times T_E}$：二维矩阵，$N_E$ 行（通道）× $T_E$ 列（时间样点）
- $N_E = 18$：18 通道（CHB-MIT 标准 10-20 蒙太奇通常 18-22 通道）
- $f_E = 256$ Hz：采样率
- $W = 30$ s：分析窗（每 30 秒切一个 sample）

**底部 viz · 邻接矩阵热图**：

- 一张 10×10 的 inferno 色块矩阵，画的是 $\mathrm{Adj}_E$ —— EEG 通道间的"图邻接"
- **怎么算的**：取每个通道的 5 个频带（δ/θ/α/β/γ）band-power 向量做 k-NN，相似的两个通道连边；亮黄色 = 强连接，紫色 = 弱/无连接
- 对角线全亮（自己跟自己最像，约定 = 1）
- 这个 Adj 后面会喂给"GAT · EEG branch"做图卷积

---

## 2. fNIRS Input · HbO + HbR（左下 · 蓝色 · 输入）

**做什么**：原始功能性近红外的入口。

**面板里的内容**：

- $\mathbf{X}^F \in \mathbb{R}^{N_F \times T_F \times 2}$：三维张量。最后那个 ×2 就是 **HbO**（氧合血红蛋白）和 **HbR**（脱氧血红蛋白）两条通道
- $N_F = 24$：fNIRS 光极对数（探测器-发射器对）
- $f_F = 10$ Hz：采样率（fNIRS 比 EEG 慢得多，因为它测的是血流响应）
- "concurrent EEG+fNIRS cap"：同步采集帽，EEG 和 fNIRS 共用一个头戴设备

**底部 viz · 邻接矩阵热图**：

- 同样 10×10 inferno 色块，但 seed 不同 → 模式跟 EEG 那张不一样
- **怎么算的**：取每个 fNIRS 通道的 hemodynamic signature（典型的 HRF 形状参数：峰值时间、振幅、宽度），用相似度做 k-NN
- 这反映 EEG 和 fNIRS 的图结构本质上不同（信号机理不同），所以两条支路必须各自单独做图特征

---

## 3. GAT · EEG branch（第二列上 · 浅蓝色 · 单模态 GAT）

**做什么**：在 EEG 通道图上做**多头图注意力网络**（Graph Attention Network），学习 channel-level 的特征表示。

**面板里的内容**：

- "k-NN on band-power"：图怎么连——用频带功率做 k-NN（前面 Adj_E 的来源）
- "multi-head, $K = 4$"：4 个并行的注意力头
- "$d = 64$, dropout 0.1"：每个节点 embed 到 64 维，dropout 防过拟合

**底部 viz · 3D 透视棒棒糖图**：

- 14 根蓝色立柱，立柱高度 = 该节点（通道）某个 attention head 对应的 feature 强度
- 立柱之间稀疏连接的细线 = GAT 学到的注意力权重高的边
- 立柱顶面用了透视（小斜面）让它看起来像 3D，参考浙大那张图的"出版插图"风格

**GAT 的关键公式**（背后做的事）：

$$
\alpha_{ij} = \mathrm{softmax}_j\bigl(\mathrm{LReLU}(\mathbf{a}^\top [\mathbf{W}\mathbf{h}_i \,\Vert\, \mathbf{W}\mathbf{h}_j])\bigr)
$$

$$
\mathbf{h}_i' = \sigma\!\left(\sum_j \alpha_{ij}\,\mathbf{W}\mathbf{h}_j\right)
$$

输出是 $\mathbf{h}^E \in \mathbb{R}^{N_E \times d}$ —— 每个 EEG 通道一条 64 维特征。

---

## 4. GAT · fNIRS branch（第二列下 · 浅蓝色 · 单模态 GAT）

**做什么**：跟模块 3 镜像，但作用在 fNIRS 通道图上。

**面板里的内容**：

- "k-NN on hemo signature"：基于血流动力学指纹连图
- "multi-head, $K = 4$"：同样 4 头
- "HbO+HbR channel-wise"：HbO 和 HbR 共享 GAT 权重但各自独立 forward（避免参数翻倍）

**底部 viz · 3D 透视棒棒糖图**：

- 紫色立柱，跟 EEG 那个是镜像但 seed 不同 → 高度分布不同
- 紫色 vs 蓝色的色彩对比强调了"两条独立的模态支路"

输出 $\mathbf{h}^F \in \mathbb{R}^{N_F \times d}$，但**此时 hemodynamic 信号还没跟电信号对齐** —— 这是下一步要解决的问题。

---

## 5. Identity (EEG)（第三列上 · 黄色 · 异质融合段）

**做什么**：什么都不做，直接 pass-through。

**面板里的内容**：

- $\tilde{\mathbf{h}}^E = \mathbf{h}^E$：恒等映射
- "electric is reference"：电信号是时间基准（EEG 几乎没有传导延迟，可以视为癫痫起始的"瞬时"时间标尺）
- "(no HRF delay)"：不用做任何位移补偿

**为什么要画这个面板**：架构对称性 —— 下方 fNIRS 路径要做 HRF 软位移，上方 EEG 路径要"什么都不做"，画一个 Identity 块明确告诉读者"这里没有遗漏，是有意保持的"。论文里这是个**关键的架构决策**：以电信号为锚点对齐血流，而不是反过来。

**没有 viz**：因为它表达的是"不做处理"，画一个图反而误导读者以为它做了什么。

---

## 6. HRF Soft-Shift（第三列下 · **橙色 · 核心创新**）

**做什么**：**这是论文最锐利的差异化**。给每条 fNIRS 通道学一个软的、可微的时间位移 $\tau_c$，把血流响应往前对齐到电信号起点。

**面板里的内容**：

- "learnable $\tau_c \in [0, \tau_{\max}]$"：每个通道一个独立的位移参数 $\tau_c$，端到端跟 GAT 一起训练
- $\tilde{\mathbf{h}}^F_c = \mathbf{h}^F_c \star \delta_\sigma(t - \tau_c)$：把通道 c 的特征跟一个**高斯软 delta 核**（中心在 $\tau_c$、宽度 $\sigma$）做卷积——相当于把信号往前/后挪 $\tau_c$ 秒，但是用可微的方式
- "aligns hemo to onset"：对齐血流到（电信号判定的）发作起点

**底部 viz · HRF 软核曲线**：

- 左边深蓝色竖线 + 三角箭头 = 电信号 δ（瞬时 onset，在 $t = 0$）
- 右边红色钟形曲线 = 学出来的 $\delta_\sigma(t - \tau_c)$，峰值在 $\tau_c$
- 中间虚线箭头 = "soft shift"，把血流响应往前对齐
- 横轴下方写着 "τc"，标注 = "δσ(t − τc) · learnable"（强调这是可学习的，不是固定卷积核）

**为什么这是创新**：

- 浙大那篇 MA-MP-GF [10] 没建模 HRF 时移，直接 concat 两个模态——但 HRF 在不同患者 / 通道间存在 1-6 s 的非平稳异质性 [11]
- 现有 fNIRS+EEG 工作多用一个固定的 canonical HRF（统一 6 s 峰值）做反卷积——但这忽略了个体差异
- 本文的 $\tau_c$ 是**可微的、逐通道的、跟 GAT 联合训练的**——这是和所有竞争者最锐利的区别

---

## 7. Heterogeneous Multi-Head GAT（第四列 · 跨两行 · 黄色）

**做什么**：把对齐后的 EEG 和 fNIRS 节点放进**同一张异质图**里跨模态做注意力。

**面板里的内容**：

- "nodes = EEG ∪ fNIRS channels"：节点池 = 18 + 24 = 42 个节点（不区分模态）
- "edge types $r \in \{EE, EF, FE, FF\}$"：4 种边类型——EEG-EEG / EEG-fNIRS / fNIRS-EEG / fNIRS-fNIRS
- $e^{(r)}_{ij} = \mathrm{LReLU}(\mathbf{a}_r^\top [\mathbf{W}_r \mathbf{h}_i \,\Vert\, \mathbf{W}_{r'} \mathbf{h}_j])$：每种边类型 $r$ 有自己的投影矩阵 $\mathbf{W}_r$ 和注意力向量 $\mathbf{a}_r$
- $\alpha^{(r)}_{ij} = \mathrm{softmax}_j(e^{(r)}_{ij})$：在每种边类型内独立做 softmax 归一化
- "multi-head $K = 8$, $d_h = 64$"：8 个注意力头（比单模态 GAT 翻倍，因为信息量更大）
- "attention → interpretable"：训练完可以可视化哪些跨模态边（EF / FE）权重高 → 临床可解释

**底部 viz · 4 象限邻接矩阵**：

- 12×12 矩阵，**用白色十字线分成 4 个 6×6 象限**
- 左上 EE / 右下 FF：同模态象限，密度高（同模态通道关联性强）
- 右上 EF / 左下 FE：跨模态象限，密度低但**关键**——这些就是 NVC（neurovascular coupling）的可解释证据
- inferno 色板表示注意力权重强弱

---

## 8. Gated Cross-Modal Fusion（第五列 · 跨两行 · 黄色）

**做什么**：把异质 GAT 输出的两组特征 $\mathbf{H}^E$ 和 $\mathbf{H}^F$ **逐样本自适应加权**地融合成一个统一表示 $\mathbf{H}$。

**面板里的内容**：

- "modality gates $g_E, g_F \in [0,1]^d$"：两个 d 维的门向量
- $g_m = \sigma(\mathbf{W}_g [\mathbf{H}^E \Vert \mathbf{H}^F] + \mathbf{b}_g)$：门值是用两个模态拼起来过 sigmoid 算出来的——**所以同一个网络对不同样本可以学不同的融合权重**
- $\mathbf{H} = g_E \odot \mathbf{H}^E + g_F \odot \mathbf{H}^F$：逐元素相乘再相加（element-wise gated sum）
- "sample-adaptive weighting"：不像普通 concat 那样静态——某些 fNIRS 信噪比差的患者，门会自动把 $g_F$ 拉低、$g_E$ 拉高
- "sparse $L_1$ prior on $g$"：训练加 L1 正则迫使门稀疏，等价于"自动模态选择"

**底部 viz · 门控比例条**：

- 上面深蓝色 $g_E = 0.62$ 横条
- 下面红色 $g_F = 0.41$ 横条
- 数值合起来不必等于 1（不是 softmax，是独立 sigmoid）
- 这种"侧栏 bar 表示量级"是论文图常用的语言

**为什么有用**：解决了多模态融合的**通用难题**——什么时候信哪个模态？让模型自己学，而且每个样本可以不一样。

---

## 9. Classifier + Event Decoder（第六列 · 跨两行 · 绿色 · 输出）

**做什么**：从融合特征 $\mathbf{H}$ 走到最终的发作期事件预测。

**面板里的内容**：

- "BiGRU + 2D-CNN readout"：双向 GRU 抓时序长程依赖 + 2D-CNN 抓"时间×通道"局部纹理
- "window logits $p_t \in [0,1]$"：每个 30 s 窗口出一个发作概率
- "merge $p_t > 0.5$ windows"：连续 $> 0.5$ 的窗口合并成一个事件
- "min 10 s, refractory 30 s"：事件至少 10 秒；两个事件之间至少 30 秒空白才算独立事件（防止抖动多算）
- $\mathrm{Out} \in \{\mathrm{Ictal}, \mathrm{Non\text{-}ictal}\}$：最终输出二值
- "event-level SE↑, FA/h↓"：评价用**事件级**敏感性 SE 和**每小时假阳性率** FA/h（不是常规的 window-level accuracy——临床更看重前者）
- "LOSO patient-independent"：留一患者交叉验证（最严苛的泛化协议）

**底部 viz · 事件级输出可视化**：

- **上半** = 30 s EEG 时序条（深蓝色 squiggly line），中间一段 35%-75% 处是**红色阴影发作期**（带虚线框 + "ictal" 标签），振幅明显大于两侧基线
- **下半** = $p_t$ 概率轨迹（绿色折线）：在发作期跳到 ~0.92，非发作期 ~0.08；中间灰虚线 = 0.5 阈值
- 底部标 "Ictal 0.92" / "Non-ictal 0.08" 双置信度
- 这比浙大那张图的"4 个表情 emoji"专业得多——表达了**临床决策证据链**：EEG 看到、概率超过、合并成事件

---

## 整体逻辑线（一句话）

> **EEG / fNIRS 各自先做单模态图特征 → fNIRS 路径学一个可微的时移把血流对齐到电信号起点（核心创新）→ 两模态合成异质图做 8 头跨模态注意力 → 门控自适应融合 → BiGRU+CNN 读出窗口概率 → 事件解码出最终的发作期标签**

整张图同时承担**架构示意 + 关键变量定义 + 可视化背书**三个功能，是论文的 Fig. 1。

---

## 编辑者备忘

如果以后要调整这张图：

- **改文字**：直接在右侧 Inspector 的"模块编辑"里选一个面板改 body。所有改动都可保存为 slot / 导出 JSON。
- **改 viz**：viz 是 PanelSpec 的 `viz` 字段（值为 `'adj-eeg' | 'adj-fnirs' | 'adj-het' | 'lollipop-eeg' | 'lollipop-fnirs' | 'hrf-kernel' | 'gate-bars' | 'event-output'`），渲染逻辑在 `src/charts/gat-cmc-overall/index.tsx` 顶部 `VIZ_HEIGHT` 注释段附近。要新加一种 viz 就增加一个 case + 一个 `Viz...` 组件。
- **改色板**：`PALETTE` 控制面板边框色 / 填充色；`INFERNO_STOPS` 控制邻接矩阵色板。
- **导出英文期刊版 / 切换中文研讨版**：右侧 Inspiration 面板，点 "GAT-CMC-Net (Fig. 1, v2)" / "中文标注版" 瓦片。中文版只为研讨用，导出 SVG / PNG 给期刊前一键切回英文。
