// 观感参数（光照 / AO / 描边）。风格的全部"旋钮"集中在这里。
//
// 三条硬性立场：
//  1. **不做实时 PBR**。没有 BRDF、没有金属度/粗糙度、没有环境探针。
//     面 = 一个基色 × 一个光照标量。
//  2. **柔和环境光为主，平行光为辅**。环境光用半球模型（天顶偏冷、地面偏暖），
//     平行光是软的：Lambert 的硬终止线用 `sunSoftness` 抹开。
//  3. **AO 只做轻微**。烘焙出来的遮蔽只按 `aoStrength` 比例压暗，
//     而且对直射光的压制比环境光更弱 —— 免得把平的墙面压成脏的。

import { norm, clamp01, lerp3 } from './vec.mjs';
import { makeGrade } from './grade.mjs';
import { makeGrain } from './grain.mjs';

export const PRESETS = {
  // 默认：**风格化预渲染资产**。
  // 关键在三个地方 ——
  //   1. 光比拉开：环境光压到 0.24、平行光加到 0.88、柔化收到 0.22，
  //      三档明度落到 228 / 188 / 153（灰度值），旧 soft 大约是 224 / 190 / 172。
  //      数字上看差别不大，但这三档之间**不再有中间调**，体积是一刀切出来的。
  //   2. 双色调：阴影偏冷、受光偏暖，再叠加分离调色。
  //   3. 描边「色持」：轮廓不是压成黑，而是往深蓝紫收敛。
  stylized: {
    sun: [0.48, 0.20, 0.85],
    sunColor: [1.12, 1.00, 0.80],
    skyColor: [0.58, 0.74, 1.06],
    groundColor: [0.44, 0.39, 0.56],
    ambient: 0.24,
    sunIntensity: 0.88,
    sunSoftness: 0.22,
    aoStrength: 0.46,
    aoDirect: 0.50,
    outlineSilhouette: 0.46,
    outlineCrease: 0.72,
    creaseAngle: 32,
    outlineTint: [0.84, 0.90, 1.12],
    grade: {
      contrast: 1.18,
      pivot: 0.70,
      saturation: 1.14,
      splitAmount: 0.40,
      shadowTint: [-0.045, -0.012, 0.060],
      highlightTint: [0.040, 0.018, -0.026],
      steps: 0,
      stepPull: 0,
    },
    // 颗粒：1 个输出像素约 0.0072 世界单位，幅度由材质表按族给（抹灰/砖/瓦 ~4~6%）
    grain: { scale: 0.0072, amount: 1.0, twoOctave: true },
  },
  // 上一版的观感，留着做 A/B 对照：光比软、颜色灰、描边几乎是黑的。
  soft: {
    sun: [0.48, 0.20, 0.85],
    sunColor: [1.00, 0.975, 0.925],
    skyColor: [0.74, 0.82, 0.97],
    groundColor: [0.66, 0.62, 0.56],
    ambient: 0.46,
    sunIntensity: 0.66,
    sunSoftness: 0.38,
    aoStrength: 0.34,
    aoDirect: 0.42,
    outlineSilhouette: 0.64,
    outlineCrease: 0.82,
    creaseAngle: 32,
    outlineTint: [1, 1, 1],
    grade: { contrast: 1, pivot: 0.68, saturation: 1, splitAmount: 0, steps: 0, stepPull: 0 },
    grain: { enabled: false },
  },
  // 更亮的展厅观感：环境光更多、阴影更浅。
  bright: {
    sun: [0.42, 0.20, 0.88],
    sunColor: [1.02, 1.00, 0.95],
    skyColor: [0.76, 0.85, 1.00],
    groundColor: [0.62, 0.58, 0.60],
    ambient: 0.44,
    sunIntensity: 0.62,
    sunSoftness: 0.44,
    aoStrength: 0.28,
    aoDirect: 0.36,
    outlineSilhouette: 0.62,
    outlineCrease: 0.84,
    creaseAngle: 36,
    outlineTint: [0.92, 0.95, 1.04],
    grade: {
      contrast: 1.16, pivot: 0.70, saturation: 1.06, splitAmount: 0.60,
      shadowTint: [-0.032, -0.008, 0.048], highlightTint: [0.030, 0.014, -0.020],
      steps: 0, stepPull: 0,
    },
    grain: { enabled: false },
  },
  // 强侧逆光 + 分档：最"版画"的一档，适合当封面图。
  dramatic: {
    sun: [0.68, 0.06, 0.73],
    sunColor: [1.10, 1.00, 0.84],
    skyColor: [0.55, 0.68, 0.96],
    groundColor: [0.44, 0.40, 0.50],
    ambient: 0.26,
    sunIntensity: 0.98,
    sunSoftness: 0.20,
    aoStrength: 0.50,
    aoDirect: 0.60,
    outlineSilhouette: 0.44,
    outlineCrease: 0.70,
    creaseAngle: 28,
    outlineTint: [0.82, 0.88, 1.10],
    grade: {
      contrast: 1.42, pivot: 0.66, saturation: 1.16, splitAmount: 1.20,
      shadowTint: [-0.060, -0.016, 0.095], highlightTint: [0.060, 0.026, -0.040],
      steps: 9, stepPull: 0.40,
    },
    // 分档和颗粒会打架（噪点跨档边界会变成椒盐点），所以这一档默认关颗粒
    grain: { enabled: false },
  },
};

export function makeLook(opts = {}) {
  const base = PRESETS[opts.preset ?? 'stylized'];
  if (!base) throw new Error(`未知观感预设 ${opts.preset}；可用：${Object.keys(PRESETS).join(', ')}`);
  const o = { ...base, ...opts };

  const look = {
    preset: opts.preset ?? 'stylized',
    sun: norm(o.sun),
    sunColor: o.sunColor,
    skyColor: o.skyColor,
    groundColor: o.groundColor,
    ambient: o.ambient,
    sunIntensity: o.sunIntensity,
    sunSoftness: o.sunSoftness,
    aoStrength: o.aoStrength,
    aoDirect: o.aoDirect,
    aoRays: o.aoRays ?? 20,
    aoDist: o.aoDist ?? 0.9,
    aoSteps: o.aoSteps ?? 16,
    aoBias: o.aoBias ?? 0.012,
    grime: o.grime ?? 0.0,
    outlineSilhouette: o.outlineSilhouette,
    outlineCrease: o.outlineCrease,
    creaseAngle: o.creaseAngle,
    outlineTint: o.outlineTint ?? [1, 1, 1],
    gamma: o.gamma ?? 2.0,
    grade: makeGrade({ ...(base.grade ?? {}), ...(opts.grade ?? {}) }),
    grain: makeGrain({ ...(base.grain ?? {}), ...(opts.grain ?? {}) }),
  };
  look.creaseCos = Math.cos((look.creaseAngle * Math.PI) / 180);

  /**
   * 每个面的光照（AO 之外的部分，逐像素再乘 AO 修正）。
   * @param {number[]} n 世界空间法线
   * @returns {{amb:number[], dif:number[]}} 环境项与直射项（各含色调）
   */
  look.faceLight = (n) => {
    const sky = clamp01(0.5 + 0.5 * n[2]);
    const ambTint = lerp3(look.groundColor, look.skyColor, sky);
    const d = n[0] * look.sun[0] + n[1] * look.sun[1] + n[2] * look.sun[2];
    const w = look.sunSoftness;
    const dif = clamp01((d + w) / (1 + w));
    return {
      amb: [ambTint[0] * look.ambient, ambTint[1] * look.ambient, ambTint[2] * look.ambient],
      dif: [look.sunColor[0] * dif * look.sunIntensity, look.sunColor[1] * dif * look.sunIntensity, look.sunColor[2] * dif * look.sunIntensity],
    };
  };

  return look;
}
