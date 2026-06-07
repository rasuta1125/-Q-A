
import { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend
} from "recharts";

const CALENDAR_ID = "c_71eb3bcb852f2600b294fddc17dd551af498b61722b5076438547860b40fae0b@group.calendar.google.com";

// ── プラン・性別 固定データ（2025年1月〜2026年3月）──
const STATIC_PLANS = {
  "2025-01": {label:"2025年1月",total:24,plans:[{"name":"七五三データプラン","count":8},{"name":"データプラン","count":8},{"name":"一面台紙プラン","count":3},{"name":"家族写真プラン","count":2},{"name":"アルバムプラン","count":2},{"name":"七五三一面台紙プラン","count":1}],genderMap:{"性別なし":24,"男の子":0,"女の子":0}},
  "2025-02": {label:"2025年2月",total:23,plans:[{"name":"データプラン","count":13},{"name":"アルバムプラン","count":3},{"name":"一面台紙プラン","count":2},{"name":"七五三データプラン","count":2},{"name":"研修撮影","count":2},{"name":"七五三一面台紙プラン","count":1}],genderMap:{"性別なし":23,"男の子":0,"女の子":0}},
  "2025-03": {label:"2025年3月",total:29,plans:[{"name":"データプラン","count":17},{"name":"七五三データプラン","count":4},{"name":"七五三アルバムプラン","count":3},{"name":"アルバムプラン","count":2},{"name":"一面台紙プラン","count":2},{"name":"ニューボーンフォト","count":1}],genderMap:{"性別なし":29,"男の子":0,"女の子":0}},
  "2025-04": {label:"2025年4月",total:13,plans:[{"name":"データプラン","count":5},{"name":"七五三データプラン","count":2},{"name":"一面台紙プラン","count":2},{"name":"アルバムプラン","count":2},{"name":"入学フォト","count":1},{"name":"Open記念プラン","count":1}],genderMap:{"性別なし":13,"男の子":0,"女の子":0}},
  "2025-05": {label:"2025年5月",total:17,plans:[{"name":"100日フォト（男の子）","count":6},{"name":"100日フォト（女の子）","count":4},{"name":"ミルクバスプラン","count":2},{"name":"七五三データプラン","count":1},{"name":"マタニティ","count":1},{"name":"1歳バースデーフォト（男の子）","count":1},{"name":"1歳バースデーフォト（女の子）","count":1},{"name":"データプラン","count":1}],genderMap:{"性別なし":5,"男の子":7,"女の子":5}},
  "2025-06": {label:"2025年6月",total:16,plans:[{"name":"1歳バースデーフォト（男の子）","count":4},{"name":"ニューボーンフォト","count":2},{"name":"100日フォト（男の子）","count":2},{"name":"100日フォト（女の子）","count":2},{"name":"家族写真プラン","count":2},{"name":"ミルクバスプラン","count":2},{"name":"1歳バースデーフォト（女の子）","count":1},{"name":"マタニティ","count":1}],genderMap:{"性別なし":7,"男の子":6,"女の子":3}},
  "2025-07": {label:"2025年7月",total:33,plans:[{"name":"2周年限定プラン","count":9},{"name":"1歳バースデーフォト（女の子）","count":5},{"name":"100日フォト（男の子）","count":4},{"name":"ミルクバスプラン","count":4},{"name":"1歳バースデーフォト（男の子）","count":3},{"name":"100日フォト（女の子）","count":2},{"name":"七五三データプラン","count":2},{"name":"七五三アルバムプラン","count":1},{"name":"2歳バースデー","count":1},{"name":"家族写真プラン","count":1},{"name":"ニューボーンフォト","count":1}],genderMap:{"性別なし":19,"男の子":7,"女の子":7}},
  "2025-08": {label:"2025年8月",total:50,plans:[{"name":"1歳バースデーフォト（女の子）","count":12},{"name":"1歳バースデーフォト（男の子）","count":8},{"name":"100日フォト（女の子）","count":7},{"name":"七五三データプラン","count":5},{"name":"ハーフバースデー","count":4},{"name":"2周年限定プラン","count":4},{"name":"ニューボーンフォト","count":4},{"name":"100日フォト（男の子）","count":3},{"name":"8月限定プラン","count":2},{"name":"家族写真プラン","count":1}],genderMap:{"男の子":11,"性別なし":20,"女の子":19}},
  "2025-09": {label:"2025年9月",total:29,plans:[{"name":"1歳バースデーフォト（女の子）","count":8},{"name":"1歳バースデーフォト（男の子）","count":6},{"name":"100日フォト（男の子）","count":5},{"name":"ミルクバスプラン","count":4},{"name":"100日フォト（女の子）","count":2},{"name":"ニューボーンフォト","count":1},{"name":"七五三データプラン","count":1},{"name":"スマッシュケーキ","count":1},{"name":"8月限定プラン","count":1}],genderMap:{"男の子":11,"性別なし":8,"女の子":10}},
  "2025-10": {label:"2025年10月",total:31,plans:[{"name":"1歳バースデーフォト（女の子）","count":7},{"name":"1歳バースデーフォト（男の子）","count":5},{"name":"100日フォト（男の子）","count":4},{"name":"100日フォト（女の子）","count":3},{"name":"七五三データプラン","count":2},{"name":"七五三アルバムプラン","count":2},{"name":"ハーフバースデー","count":2},{"name":"ミルクバスプラン","count":1},{"name":"マタニティ","count":1},{"name":"七五三一面台紙プラン","count":1},{"name":"2歳バースデー","count":1}],genderMap:{"男の子":9,"女の子":10,"性別なし":12}},
  "2025-11": {label:"2025年11月",total:50,plans:[{"name":"七五三データプラン","count":16},{"name":"1歳バースデーフォト（女の子）","count":10},{"name":"1歳バースデーフォト（男の子）","count":4},{"name":"七五三アルバムプラン","count":3},{"name":"100日フォト（女の子）","count":3},{"name":"100日フォト（男の子）","count":2},{"name":"七五三一面台紙プラン","count":2},{"name":"2歳バースデー","count":2},{"name":"マタニティ","count":2},{"name":"ニューボーンフォト","count":1},{"name":"ハーフバースデー","count":1},{"name":"団体フォト","count":1}],genderMap:{"女の子":13,"男の子":6,"性別なし":31}},
  "2025-12": {label:"2025年12月",total:41,plans:[{"name":"七五三データプラン","count":12},{"name":"100日フォト（女の子）","count":6},{"name":"1歳バースデーフォト（女の子）","count":6},{"name":"1歳バースデーフォト（男の子）","count":5},{"name":"100日フォト（男の子）","count":5},{"name":"2歳バースデー","count":4},{"name":"マタニティ","count":1},{"name":"七五三一面台紙プラン","count":1},{"name":"七五三アルバムプラン","count":1}],genderMap:{"男の子":10,"女の子":12,"性別なし":19}},
  "2026-01": {label:"2026年1月",total:29,plans:[{"name":"ハーフバースデー","count":5},{"name":"1歳バースデーフォト（女の子）","count":5},{"name":"七五三データプラン","count":5},{"name":"100日フォト（女の子）","count":5},{"name":"1歳バースデーフォト（男の子）","count":4},{"name":"家族写真プラン","count":1},{"name":"ニューボーンフォト","count":1},{"name":"100日フォト（男の子）","count":1},{"name":"マタニティ","count":1},{"name":"ミルクバスプラン","count":1}],genderMap:{"性別なし":14,"男の子":5,"女の子":10}},
  "2026-02": {label:"2026年2月",total:46,plans:[{"name":"1歳バースデーフォト（男の子）","count":8},{"name":"100日フォト（女の子）","count":8},{"name":"1歳バースデーフォト（女の子）","count":7},{"name":"マタニティ","count":5},{"name":"研修撮影","count":4},{"name":"100日フォト（男の子）","count":3},{"name":"七五三データプラン","count":3},{"name":"ハーフバースデー","count":3},{"name":"ミルクバスプラン","count":2},{"name":"2歳バースデー","count":2},{"name":"ニューボーンフォト","count":1}],genderMap:{"性別なし":20,"男の子":11,"女の子":15}},
  "2026-03": {label:"2026年3月",total:39,plans:[{"name":"100日フォト（女の子）","count":8},{"name":"1歳バースデーフォト（女の子）","count":7},{"name":"1歳バースデーフォト（男の子）","count":6},{"name":"七五三データプラン","count":5},{"name":"100日フォト（男の子）","count":4},{"name":"2歳バースデー","count":3},{"name":"家族写真プラン","count":2},{"name":"マタニティ","count":1},{"name":"七五三アルバムプラン","count":1},{"name":"ハーフバースデー","count":1},{"name":"入学フォトプラン","count":1}],genderMap:{"男の子":10,"性別なし":14,"女の子":15}},
};

// ── 2025年実績（固定）──
const data2025 = [
  { month:"1月",  plan:707800,  goods:116000,  total:823800,  qty:30, avgUnit:27460, goodsRate:16.4 },
  { month:"2月",  plan:632400,  goods:104100,  total:736500,  qty:24, avgUnit:30687, goodsRate:16.5 },
  { month:"3月",  plan:854900,  goods:219800,  total:1074700, qty:31, avgUnit:34667, goodsRate:25.7 },
  { month:"4月",  plan:303400,  goods:109850,  total:413250,  qty:16, avgUnit:25828, goodsRate:36.2 },
  { month:"5月",  plan:383200,  goods:78100,   total:461300,  qty:17, avgUnit:27135, goodsRate:20.4 },
  { month:"6月",  plan:448400,  goods:65200,   total:513600,  qty:20, avgUnit:25680, goodsRate:14.5 },
  { month:"7月",  plan:667100,  goods:166000,  total:833100,  qty:29, avgUnit:28727, goodsRate:24.9 },
  { month:"8月",  plan:1222900, goods:308200,  total:1531100, qty:48, avgUnit:31897, goodsRate:25.2 },
  { month:"9月",  plan:779800,  goods:136200,  total:916000,  qty:28, avgUnit:32714, goodsRate:17.5 },
  { month:"10月", plan:891200,  goods:146900,  total:1038100, qty:30, avgUnit:34603, goodsRate:16.5 },
  { month:"11月", plan:1192400, goods:258900,  total:1451300, qty:44, avgUnit:32984, goodsRate:21.7 },
  { month:"12月", plan:1055700, goods:127100,  total:1182800, qty:41, avgUnit:28848, goodsRate:12.0 },
];

// ── 静的フォールバック（カレンダー未取得時）──
const STATIC = {
  bookingFlow: [
    { shootMonth:"2月", total:43, flow:[{bookedIn:"12月以前",count:5,color:"#a78bfa"},{bookedIn:"1月中",count:16,color:"#64d9ff"},{bookedIn:"2月中",count:22,color:"#34d399"}] },
    { shootMonth:"3月", total:37, flow:[{bookedIn:"1月中",count:9,color:"#a78bfa"},{bookedIn:"2月中",count:17,color:"#64d9ff"},{bookedIn:"3月中",count:11,color:"#34d399"}] },
    { shootMonth:"4月", total:0,  flow:[] },
  ],
  snapshots: [
    { month:"1月末", nextMonth:"2月", confirmedAtEnd:21, finalTotal:43, fillRate:49 },
    { month:"2月末", nextMonth:"3月", confirmedAtEnd:26, finalTotal:37, fillRate:70 },
    { month:"3/4",   nextMonth:"4月", confirmedAtEnd:0,  finalTotal:null, fillRate:0 },
  ],
  leadTime: [
    { range:"当日〜7日前", count:31, color:"#f87171" },
    { range:"8〜14日前",  count:20, color:"#ffc864" },
    { range:"15〜30日前", count:36, color:"#64d9ff" },
    { range:"31〜60日前", count:28, color:"#34d399" },
    { range:"61日以上前", count:1,  color:"#a78bfa" },
  ],
  bookingFlowAll: [
    { shootMonth:"2026年3月", total:37, flow:[{bookedIn:"1月中",count:9,color:"#a78bfa"},{bookedIn:"2月中",count:17,color:"#64d9ff"},{bookedIn:"3月中",count:11,color:"#34d399"}] },
    { shootMonth:"2026年2月", total:43, flow:[{bookedIn:"12月中",count:5,color:"#a78bfa"},{bookedIn:"1月中",count:16,color:"#64d9ff"},{bookedIn:"2月中",count:22,color:"#34d399"}] },
    { shootMonth:"2026年1月", total:26, flow:[{bookedIn:"12月中",count:10,color:"#a78bfa"},{bookedIn:"1月中",count:16,color:"#64d9ff"}] },
  ],
  avgLead:21, medianLead:17, maxLead:66, directPct:27, totalEvents:116,
  data2026:[
    { month:"1月", qty:33, planBase:858000,  goodsPred:140615, totalPred:998615  },
    { month:"2月", qty:38, planBase:988000,  goodsPred:162635, totalPred:1150635 },
    { month:"3月", qty:37, planBase:962000,  goodsPred:247336, totalPred:1209336 },
    { month:"4月", qty:36, planBase:936000,  goodsPred:338891, totalPred:1274891 },
  ],
};

// ── カレンダーイベント→分析 ──
function analyzeEvents(events) {
  const now = new Date();
  const COLORS = ["#a78bfa","#64d9ff","#34d399","#ffc864","#f87171"];

  // shoot月ごとにグループ
  const byShoot = {};
  events.forEach(ev => {
    const start   = new Date(ev.start?.dateTime || ev.start?.date || ev.start);
    const created = new Date(ev.created);
    if (isNaN(start) || isNaN(created)) return;
    const key = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}`;
    (byShoot[key] = byShoot[key]||[]).push({ start, created, description: ev.description || "" });
  });

  const sortedKeys = Object.keys(byShoot).sort();

  // 直近3ヶ月の bookingFlow
  const recentKeys = sortedKeys.slice(-3);
  const bookingFlow = recentKeys.map(key => {
    const items = byShoot[key];
    const [,m] = key.split("-");
    const flowMap = {};
    items.forEach(({created}) => {
      const label = `${created.getMonth()+1}月中`;
      flowMap[label] = (flowMap[label]||0)+1;
    });
    const flow = Object.entries(flowMap).map(([bookedIn,count],i) => ({bookedIn,count,color:COLORS[i%COLORS.length]}));
    return { shootMonth:`${parseInt(m)}月`, total:items.length, flow };
  });

  // 全月分のbookingFlow（履歴タブ用）
  const bookingFlowAll = sortedKeys.map(key => {
    const items = byShoot[key];
    const [y,m] = key.split("-");
    const flowMap = {};
    items.forEach(({created}) => {
      const label = `${created.getFullYear() !== parseInt(y) ? created.getFullYear()+"年" : ""}${created.getMonth()+1}月中`;
      flowMap[label] = (flowMap[label]||0)+1;
    });
    const flow = Object.entries(flowMap).map(([bookedIn,count],i) => ({bookedIn,count,color:COLORS[i%COLORS.length]}));
    return { shootMonth:`${y}年${parseInt(m)}月`, total:items.length, flow };
  }).reverse(); // 新しい月が上

  // スナップショット：前月末→今月 / 今月末→翌月 / 今日→翌翌月
  const snapshots = [];
  for (let offset = -1; offset <= 1; offset++) {
    const refDate = new Date(now.getFullYear(), now.getMonth()+offset, 1);
    const nextDate = new Date(now.getFullYear(), now.getMonth()+offset+1, 1);
    const nextKey  = `${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,"0")}`;
    const items    = byShoot[nextKey] || [];
    let cutoff, label;
    if (offset < 0) {
      cutoff = new Date(refDate.getFullYear(), refDate.getMonth()+1, 0, 23,59,59);
      label  = `${refDate.getMonth()+1}月末`;
    } else if (offset === 0) {
      cutoff = now;
      label  = `${now.getMonth()+1}/${now.getDate()}`;
    } else {
      cutoff = new Date(refDate.getFullYear(), refDate.getMonth()+1, 0, 23,59,59);
      label  = `${refDate.getMonth()+1}月末`;
    }
    const confirmed = items.filter(({created}) => created <= cutoff).length;
    const finalTotal = offset < 0 ? items.length : (offset===0 ? items.length : null);
    const fillRate = finalTotal ? Math.round(confirmed/finalTotal*100) : 0;
    snapshots.push({ month:label, nextMonth:`${nextDate.getMonth()+1}月`, confirmedAtEnd:confirmed, finalTotal, fillRate });
  }

  // リードタイム
  const leads = [];
  events.forEach(ev => {
    const start   = new Date(ev.start?.dateTime || ev.start?.date || ev.start);
    const created = new Date(ev.created);
    if (isNaN(start)||isNaN(created)) return;
    const diff = Math.round((start-created)/(1000*60*60*24));
    if (diff >= 0 && diff < 365) leads.push(diff);
  });
  const n = leads.length;
  const buckets = [
    {range:"当日〜7日前",lo:0, hi:7,   color:"#f87171"},
    {range:"8〜14日前", lo:8, hi:14,  color:"#ffc864"},
    {range:"15〜30日前",lo:15,hi:30,  color:"#64d9ff"},
    {range:"31〜60日前",lo:31,hi:60,  color:"#34d399"},
    {range:"61日以上前",lo:61,hi:9999,color:"#a78bfa"},
  ];
  const leadTime  = buckets.map(b => ({...b, count:leads.filter(d=>d>=b.lo&&d<=b.hi).length}));
  const sorted    = [...leads].sort((a,b)=>a-b);
  const avgLead   = n>0 ? (leads.reduce((s,v)=>s+v,0)/n).toFixed(1) : 0;
  const medianLead= n>0 ? sorted[Math.floor(n/2)] : 0;
  const maxLead   = n>0 ? Math.max(...leads) : 0;
  const directPct = n>0 ? Math.round(leads.filter(d=>d<=7).length/n*100) : 0;

  // 2026月別件数 → 売上予測
  const qty2026 = {};
  sortedKeys.filter(k=>k.startsWith("2026")).forEach(k => {
    qty2026[k] = byShoot[k].length;
  });
  const data2026 = [1,2,3,4].map(m => {
    const key   = `2026-${String(m).padStart(2,"0")}`;
    const qty   = qty2026[key] || 0;
    const d25   = data2025[m-1];
    const planBase  = qty * 26000;
    const goodsPred = Math.round(planBase * d25.goodsRate/100);
    return { month:`${m}月`, qty, planBase, goodsPred, totalPred:planBase+goodsPred };
  });

  // ── プラン・性別集計 ──
  const parsePlan = (desc) => {
    // descriptionからプラン行を抽出（"プラン名 - 時間 - 料金" の形式）
    const lines = desc.split("\n");
    for (const line of lines) {
      const m = line.match(/^(.+?)\s*-\s*\d+/);
      if (m) {
        const plan = m[1].trim();
        // Square固有の除外文字列をスキップ
        if (plan.startsWith("http") || plan.startsWith("***") || plan.match(/^\+81/) || plan.includes("@")) continue;
        return plan;
      }
    }
    return "不明";
  };

  const parseGender = (planName) => {
    if (planName.includes("男の子")) return "男の子";
    if (planName.includes("女の子")) return "女の子";
    return "性別なし";
  };

  // プラン名を正規化（七五三の長いメモ部分を省略など）
  const normalizePlan = (plan) => {
    if (plan.includes("七五三") && plan.includes("アルバム")) return "七五三アルバムプラン";
    if (plan.includes("七五三") && plan.includes("一面台紙")) return "七五三一面台紙プラン";
    if (plan.includes("七五三")) return "七五三データプラン";
    if (plan.includes("1歳バースデーフォト")) return `1歳バースデーフォト${plan.includes("男の子")?"（男の子）":plan.includes("女の子")?"（女の子）":""}`;
    if (plan.includes("100日フォト")) return `100日フォト${plan.includes("男の子")?"（男の子）":plan.includes("女の子")?"（女の子）":""}`;
    if (plan.includes("2歳バースデー")) return "2歳バースデー";
    if (plan.includes("ハーフバースデー")) return "ハーフバースデー";
    return plan;
  };

  // 月別プラン×性別集計
  const planByMonth = {};
  sortedKeys.forEach(key => {
    const [y, m] = key.split("-");
    const label  = `${y}年${parseInt(m)}月`;
    const items  = byShoot[key];
    const planMap   = {};
    const genderMap = { "男の子":0, "女の子":0, "性別なし":0 };

    items.forEach(({description}) => {
      const raw    = parsePlan(description);
      const plan   = normalizePlan(raw);
      const gender = parseGender(plan);
      planMap[plan]    = (planMap[plan]||0) + 1;
      genderMap[gender]++;
    });

    const plans = Object.entries(planMap)
      .sort((a,b) => b[1]-a[1])
      .map(([name, count]) => ({ name, count }));

    planByMonth[key] = { label, total: items.length, plans, genderMap };
  });

  // 全期間プラン集計
  const allPlanMap = {};
  const allGender  = { "男の子":0, "女の子":0, "性別なし":0 };
  Object.values(byShoot).forEach(items => {
    items.forEach(({description}) => {
      const plan   = normalizePlan(parsePlan(description));
      const gender = parseGender(plan);
      allPlanMap[plan] = (allPlanMap[plan]||0) + 1;
      allGender[gender]++;
    });
  });
  const allPlans = Object.entries(allPlanMap).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));

  return { bookingFlow, bookingFlowAll, snapshots, leadTime, avgLead, medianLead, maxLead, directPct, totalEvents:n, data2026, planByMonth, allPlans, allGender };
}

// ── イベント配列からplanByMonthを生成 ──
function buildPlanByMonth(events) {
  const result = {};
  events.forEach(ev => {
    const start = new Date(ev.start?.dateTime || ev.start?.date || ev.start);
    if (isNaN(start)) return;
    const key   = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}`;
    const label = `${start.getFullYear()}年${start.getMonth()+1}月`;
    if (!result[key]) result[key] = {label, total:0, plans:{}, genderMap:{"男の子":0,"女の子":0,"性別なし":0}};
    const desc = ev.description||"";
    let plan = "不明";
    for (const line of desc.split("\n")) {
      const l = line.trim();
      if (!l||l.startsWith("http")||l.startsWith("***")||l.startsWith("+81")||l.includes("@")) continue;
      if (/^.+\s*-\s*\d+/.test(l)) { plan = l.split(" - ")[0].trim(); break; }
    }
    if (plan.includes("七五三")&&plan.includes("アルバム")) plan="七五三アルバムプラン";
    else if (plan.includes("七五三")&&plan.includes("一面台紙")) plan="七五三一面台紙プラン";
    else if (plan.includes("七五三")) plan="七五三データプラン";
    else if (plan.includes("1歳バースデーフォト")) plan=`1歳バースデーフォト${plan.includes("男の子")?"（男の子）":plan.includes("女の子")?"（女の子）":""}`;
    else if (plan.includes("100日フォト")) plan=`100日フォト${plan.includes("男の子")?"（男の子）":plan.includes("女の子")?"（女の子）":""}`;
    else if (plan.includes("2歳バースデー")) plan="2歳バースデー";
    else if (plan.includes("ハーフバースデー")) plan="ハーフバースデー";
    const gender = plan.includes("男の子")?"男の子":plan.includes("女の子")?"女の子":"性別なし";
    result[key].plans[plan] = (result[key].plans[plan]||0)+1;
    result[key].genderMap[gender]++;
    result[key].total++;
  });
  Object.keys(result).forEach(k => {
    result[k].plans = Object.entries(result[k].plans).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));
  });
  return result;
}

// STATIC_PLANSから直近n月分の疑似イベントを生成（予約分析用）
function buildEventsFromStatic(now, months) {
  const events = [];
  for (let i = months; i >= 1; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const sd  = STATIC_PLANS[key];
    if (!sd) continue;
    sd.plans.forEach(({name, count}) => {
      for (let j=0; j<count; j++) {
        events.push({
          created: new Date(d.getFullYear(), d.getMonth()-1, 15).toISOString(),
          start:   { dateTime: new Date(d.getFullYear(), d.getMonth(), 15).toISOString() },
          description: name + " - 1 hour 30 minutes - ¥26,000"
        });
      }
    });
  }
  return events;
}

// ── Google Calendar API直接アクセス ──
async function fetchCalendarEvents(fromDate, toDate, onProgress, label) {
  onProgress?.(`${label}を取得中...`);
  const params = new URLSearchParams({
    calendarId: CALENDAR_ID,
    timeMin:    fromDate.toISOString(),
    timeMax:    toDate.toISOString(),
  });
  const res = await fetch(`/api/calendar?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!data.events || data.events.length === 0) throw new Error("イベントデータを取得できませんでした");
  return data.events;
}

// ── 予約分析・予約履歴の取得（今月〜年末） ──
async function fetchBooking(onProgress) {
  const now      = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate   = new Date(now.getFullYear(), 11, 31, 23,59,59);
  const events   = await fetchCalendarEvents(fromDate, toDate, onProgress, `${now.getMonth()+1}月〜の予約`);
  const result   = analyzeEvents(events);
  // bookingFlow・bookingFlowAllはSTATIC固定値を維持
  result.bookingFlow    = STATIC.bookingFlow;
  result.bookingFlowAll = STATIC.bookingFlowAll;
  return result;
}

// ── プラン分析の取得（今月〜年末、STATIC_PLANSとマージ） ──
async function fetchPlan(onProgress) {
  const now      = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate   = new Date(now.getFullYear(), 11, 31, 23,59,59);
  const events   = await fetchCalendarEvents(fromDate, toDate, onProgress, `${now.getMonth()+1}月〜のプラン`);

  const livePlanByMonth   = buildPlanByMonth(events);
  const mergedPlanByMonth = { ...STATIC_PLANS };
  Object.entries(livePlanByMonth).forEach(([key, val]) => {
    if (!STATIC_PLANS[key]) mergedPlanByMonth[key] = val;
  });

  const allPlanMap = {}, allGenderMap = {"男の子":0,"女の子":0,"性別なし":0};
  Object.values(mergedPlanByMonth).forEach(m => {
    m.plans.forEach(({name,count}) => {
      allPlanMap[name] = (allPlanMap[name]||0)+count;
      const g = name.includes("男の子")?"男の子":name.includes("女の子")?"女の子":"性別なし";
      allGenderMap[g] += count;
    });
  });
  return {
    planByMonth: mergedPlanByMonth,
    allPlans:    Object.entries(allPlanMap).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count})),
    allGender:   allGenderMap,
  };
}

// ── UI helpers ──
const fmt  = n => `¥${Number(n).toLocaleString()}`;
const fmtM = n => `¥${(n/10000).toFixed(0)}万`;
const total2025    = data2025.reduce((s,d)=>s+d.total,0);
const h1_2025      = data2025.slice(0,6).reduce((s,d)=>s+d.total,0);
const h2_2025      = data2025.slice(6).reduce((s,d)=>s+d.total,0);
const avgGoodsRate = (data2025.reduce((s,d)=>s+d.goodsRate,0)/12).toFixed(1);
const peakMonth    = data2025.reduce((a,b)=>a.total>b.total?a:b).month;

const Tip = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:"rgba(8,8,20,.97)",border:"1px solid rgba(255,200,100,.3)",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#fff"}}>
      <div style={{color:"#ffc864",fontWeight:700,marginBottom:4}}>{label}</div>
      {payload.map((p,i)=>p.value!=null&&<div key={i} style={{color:p.color||"#fff"}}>{p.name}：{typeof p.value==="number"&&p.value>1000?fmt(p.value):p.value}</div>)}
    </div>
  );
};

function MonthAccordion({ m, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{marginBottom:10}}>
      <div onClick={()=>setOpen(!open)} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${m.color}33`,borderRadius:12,padding:"12px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:13,fontWeight:700,color:m.color}}>{m.month}</span>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:13,fontWeight:800,color:"#fff"}}>{m.count}件</span>
          <span style={{fontSize:12,color:"rgba(255,255,255,.4)"}}>{open?"▲":"▼"}</span>
        </div>
      </div>
      {open&&(
        <div style={{border:`1px solid ${m.color}22`,borderTop:"none",borderRadius:"0 0 12px 12px",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:"rgba(255,255,255,.04)"}}>
                {["日","時間","お名前","プラン","金額"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",color:"rgba(255,255,255,.4)",fontWeight:600,borderBottom:"1px solid rgba(255,255,255,.06)"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.bookings.map((b,bi)=>(
                <tr key={bi} style={{borderBottom:"1px solid rgba(255,255,255,.04)",background:bi%2===0?"rgba(255,255,255,.01)":"transparent"}}>
                  <td style={{padding:"7px 10px",color:"rgba(255,255,255,.5)"}}>{b.day}</td>
                  <td style={{padding:"7px 10px",color:"rgba(255,255,255,.4)"}}>{b.time}</td>
                  <td style={{padding:"7px 10px",color:"#fff",fontWeight:500}}>{b.name}</td>
                  <td style={{padding:"7px 10px",color:"rgba(255,255,255,.6)"}}>{b.plan}</td>
                  <td style={{padding:"7px 10px",color:m.color,fontWeight:700}}>{b.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Dashboard() {
  const [tab,          setTab]          = useState("overview");
  const [loadingBook,  setLoadingBook]  = useState(false);
  const [loadingPlan,  setLoadingPlan]  = useState(false);
  const [errorBook,    setErrorBook]    = useState(null);
  const [errorPlan,    setErrorPlan]    = useState(null);
  const [lastUpdateBook, setLastUpdateBook] = useState("2026年3月4日（記録値）");
  const [lastUpdatePlan, setLastUpdatePlan] = useState("2026年3月4日（記録値）");
  const [liveBook,     setLiveBook]     = useState(null); // 予約分析・予約履歴
  const [livePlan,     setLivePlan]     = useState(null); // プラン分析
  const [selMonth,     setSelMonth]     = useState("all");
  const [csvText,      setCsvText]      = useState(null); // nullで非表示

  const d = liveBook ?? STATIC;
  const bookingFlowAll = liveBook?.bookingFlowAll ?? STATIC.bookingFlowAll;

  // ── 予約分析・予約履歴の更新 ──
  const handleUpdateBook = async () => {
    setLoadingBook(true); setErrorBook(null);
    try {
      const result = await fetchBooking((msg) => setErrorBook(`⏳ ${msg}`));
      setLiveBook(result);
      const n = new Date();
      setLastUpdateBook(`${n.getMonth()+1}/${n.getDate()} ${n.getHours()}:${String(n.getMinutes()).padStart(2,"0")} ライブ取得`);
    } catch(e) {
      setErrorBook(e.message);
    } finally { setLoadingBook(false); }
  };

  // ── プラン分析の更新 ──
  const handleUpdatePlan = async () => {
    setLoadingPlan(true); setErrorPlan(null);
    try {
      const result = await fetchPlan((msg) => setErrorPlan(`⏳ ${msg}`));
      setLivePlan(result);
      const n = new Date();
      setLastUpdatePlan(`${n.getMonth()+1}/${n.getDate()} ${n.getHours()}:${String(n.getMinutes()).padStart(2,"0")} ライブ取得`);
    } catch(e) {
      setErrorPlan(e.message);
    } finally { setLoadingPlan(false); }
  };

  const tabs = [
    {key:"overview",label:"概要"},
    {key:"booking", label:"予約分析"},
    {key:"history", label:"予約履歴"},
    {key:"plans",   label:"プラン分析"},
    {key:"rev25",   label:"2025年実績"},
    {key:"compare", label:"前年比較"},
    {key:"goods",   label:"グッズ分析"},
    {key:"forecast",label:"2026年予測"},
    {key:"ads",     label:"📣 広告計画"},
  ];

  const card = color=>({background:"rgba(255,255,255,.04)",border:`1px solid ${color}28`,borderRadius:14,padding:18,position:"relative",overflow:"hidden"});
  const bar  = color=>({position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${color},transparent)`});

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#070714,#0d0d2b,#0a1628)",fontFamily:"'Noto Sans JP','Hiragino Sans',sans-serif",color:"#e8e8f0"}}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* CSV モーダル */}
      {csvText&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setCsvText(null)}>
          <div style={{background:"#0d1117",border:"1px solid rgba(255,255,255,.15)",borderRadius:16,padding:24,width:"100%",maxWidth:560,maxHeight:"80vh",display:"flex",flexDirection:"column",gap:12}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>📋 データをコピーしてください</div>
              <button onClick={()=>setCsvText(null)} style={{background:"none",border:"none",color:"rgba(255,255,255,.5)",fontSize:18,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>全選択（Ctrl+A / ⌘A）→ コピー（Ctrl+C / ⌘C）→ Google Sheetsにペースト</div>
            <textarea readOnly value={csvText}
              style={{flex:1,minHeight:300,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.15)",borderRadius:8,padding:12,fontSize:11,color:"#e8e8f0",fontFamily:"monospace",resize:"vertical",outline:"none"}}
              onClick={e=>e.target.select()}
            />
            <div style={{fontSize:11,color:"rgba(100,217,255,.6)",textAlign:"center"}}>テキストエリアをクリックすると全選択されます</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{background:"rgba(255,200,100,.05)",borderBottom:"1px solid rgba(255,200,100,.15)",padding:"18px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:11,letterSpacing:"3px",color:"#ffc864",opacity:.8,marginBottom:4}}>AIMABLE PHOTO STUDIO</div>
          <div style={{fontSize:21,fontWeight:700,color:"#fff"}}>売上ダッシュボード</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <div style={{background:"rgba(100,217,255,.08)",border:"1px solid rgba(100,217,255,.25)",borderRadius:20,padding:"5px 14px",fontSize:11,color:"#64d9ff"}}>
              {liveBook?"🟢":"⚪"} 予約: {lastUpdateBook}
            </div>
            <div style={{background:"rgba(167,139,250,.08)",border:"1px solid rgba(167,139,250,.25)",borderRadius:20,padding:"5px 14px",fontSize:11,color:"#a78bfa"}}>
              {livePlan?"🟢":"⚪"} プラン: {lastUpdatePlan}
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <button onClick={handleUpdateBook} disabled={loadingBook}
              style={{background:loadingBook?"rgba(100,217,255,.08)":"rgba(100,217,255,.15)",border:"1px solid rgba(100,217,255,.4)",borderRadius:20,padding:"6px 16px",fontSize:12,color:"#64d9ff",cursor:loadingBook?"wait":"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
              <span style={{animation:loadingBook?"spin 1s linear infinite":"none",display:"inline-block"}}>🔄</span>
              {loadingBook?"取得中...":"予約を更新"}
            </button>
            <button onClick={handleUpdatePlan} disabled={loadingPlan}
              style={{background:loadingPlan?"rgba(167,139,250,.08)":"rgba(167,139,250,.15)",border:"1px solid rgba(167,139,250,.4)",borderRadius:20,padding:"6px 16px",fontSize:12,color:"#a78bfa",cursor:loadingPlan?"wait":"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
              <span style={{animation:loadingPlan?"spin 1s linear infinite":"none",display:"inline-block"}}>📋</span>
              {loadingPlan?"取得中...":"プランを更新"}
            </button>
          </div>
          {errorBook && <div style={{fontSize:11,color:"#f87171",maxWidth:280,textAlign:"right"}}>⚠️ {errorBook}</div>}
          {errorPlan && <div style={{fontSize:11,color:"#f87171",maxWidth:280,textAlign:"right"}}>⚠️ {errorPlan}</div>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:2,padding:"14px 20px 0",borderBottom:"1px solid rgba(255,255,255,.07)",overflowX:"auto"}}>
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            style={{background:tab===t.key?"rgba(255,200,100,.15)":"transparent",border:"none",borderBottom:tab===t.key?"2px solid #ffc864":"2px solid transparent",color:tab===t.key?"#ffc864":"rgba(255,255,255,.5)",padding:"9px 14px",fontSize:13,fontWeight:tab===t.key?700:400,cursor:"pointer",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{padding:20}}>

        {/* ── 概要 ── */}
        {tab==="overview"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:14,marginBottom:20}}>
              {[
                {label:"2025年 年間売上",  value:fmtM(total2025),   sub:"プラン＋グッズ込み",color:"#34d399"},
                {label:"上半期（1〜6月）", value:fmtM(h1_2025),     sub:"¥4,023,150",       color:"#64d9ff"},
                {label:"下半期（7〜12月）",value:fmtM(h2_2025),     sub:"上半期の1.7倍",     color:"#f97316"},
                {label:"年間平均単価",     value:"¥30,657",          sub:"グッズ込み実績",     color:"#ffc864"},
                {label:"グッズ上乗せ率",   value:`${avgGoodsRate}%`, sub:"年間平均",          color:"#a78bfa"},
                {label:"年間最高月",       value:peakMonth,          sub:"¥1,531,100（8月）", color:"#ec4899"},
              ].map((c,i)=>(
                <div key={i} style={card(c.color)}>
                  <div style={bar(c.color)}/>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.45)",marginBottom:8}}>{c.label}</div>
                  <div style={{fontSize:21,fontWeight:800,color:c.color,lineHeight:1}}>{c.value}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:6}}>{c.sub}</div>
                </div>
              ))}
            </div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:18,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>上半期 vs 下半期</div>
              {[{label:"上半期（1〜6月）",val:h1_2025,color:"#64d9ff"},{label:"下半期（7〜12月）",val:h2_2025,color:"#f97316"}].map(item=>(
                <div key={item.label} style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
                    <span style={{color:"rgba(255,255,255,.7)"}}>{item.label}</span>
                    <span style={{color:item.color,fontWeight:700}}>{fmt(item.val)}</span>
                  </div>
                  <div style={{height:10,background:"rgba(255,255,255,.08)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{width:`${item.val/total2025*100}%`,height:"100%",background:item.color,borderRadius:99}}/>
                  </div>
                </div>
              ))}
            </div>
            <div style={{background:"rgba(255,200,100,.08)",border:"1px solid rgba(255,200,100,.25)",borderRadius:12,padding:"14px 18px",display:"flex",gap:10}}>
              <span style={{fontSize:18}}>💡</span>
              <div style={{fontSize:12,color:"rgba(255,255,255,.65)",lineHeight:1.8}}>
                <strong style={{color:"#ffc864"}}>重要な発見：</strong>4〜6月は年間最低水準（¥413,250〜¥513,600）。グッズ上乗せ率は月によって<strong style={{color:"#fff"}}>12〜36%</strong>と大きく変動します。3月はグッズ購入率が高く（25.7%）、実際の客単価が上がりやすい月です。
              </div>
            </div>
          </div>
        )}

        {/* ── 予約分析 ── */}
        {tab==="booking"&&(
          <div>
            {!liveBook&&(
              <div style={{background:"rgba(100,217,255,.06)",border:"1px solid rgba(100,217,255,.2)",borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:12,color:"rgba(255,255,255,.5)"}}>
                ⚪ 記録済みデータを表示中。「カレンダーを更新」でリアルタイムに切り替わります。
              </div>
            )}

            <div style={{fontSize:14,fontWeight:700,marginBottom:14,color:"#fff"}}>📋 月末時点での翌月確定予約数</div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
              {d.snapshots.map((s,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"16px 18px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:8}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:"#ffc864"}}>{s.month} → {s.nextMonth}の予約</div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>
                        {s.finalTotal!=null?`この時点で${s.confirmedAtEnd}件確定 → 最終${s.finalTotal}件`:`この時点で${s.confirmedAtEnd}件確定（最終件数は未確定）`}
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:22,fontWeight:800,color:"#64d9ff"}}>{s.confirmedAtEnd}件</div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>充填率 {s.fillRate}%</div>
                    </div>
                  </div>
                  <div style={{height:10,background:"rgba(255,255,255,.08)",borderRadius:99,overflow:"hidden",marginBottom:6}}>
                    <div style={{width:`${s.fillRate}%`,height:"100%",background:"linear-gradient(90deg,#64d9ff,#34d399)",borderRadius:99}}/>
                  </div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.35)"}}>
                    {s.finalTotal!=null?`残り約${s.finalTotal-s.confirmedAtEnd}件が翌月中に追加される見込み`:"翌月分はまだ入っていません"}
                  </div>
                </div>
              ))}
            </div>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>🔄 撮影月別「いつ予約が入ったか」内訳</div>
              <button onClick={()=>{
                const rows=[["撮影月","予約タイミング","件数","割合(%)"]];
                d.bookingFlow.forEach(bf=>{
                  if(bf.total===0){rows.push([bf.shootMonth,"予約なし","0","0"]);return;}
                  bf.flow.forEach(f=>rows.push([bf.shootMonth,f.bookedIn,f.count,Math.round(f.count/bf.total*100)]));
                });
                setCsvText(rows.map(r=>r.join("\t")).join("\n"));
              }} style={{background:"rgba(52,211,153,.15)",border:"1px solid rgba(52,211,153,.4)",borderRadius:16,padding:"5px 14px",fontSize:11,color:"#34d399",cursor:"pointer",fontWeight:700}}>
                📋 CSV表示
              </button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:24}}>
              {d.bookingFlow.map((bf,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"16px 18px"}}>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>{bf.shootMonth}撮影分（計{bf.total}件）</div>
                  {bf.total===0
                    ? <div style={{fontSize:12,color:"rgba(255,255,255,.3)"}}>予約なし</div>
                    : bf.flow.map((f,j)=>{
                        const pct = Math.round(f.count/bf.total*100);
                        return (
                          <div key={j} style={{marginBottom:10}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
                              <span style={{color:"rgba(255,255,255,.65)"}}>{f.bookedIn}に予約</span>
                              <span style={{color:f.color,fontWeight:700}}>{f.count}件（{pct}%）</span>
                            </div>
                            <div style={{height:8,background:"rgba(255,255,255,.08)",borderRadius:99,overflow:"hidden"}}>
                              <div style={{width:`${pct}%`,height:"100%",background:f.color,borderRadius:99,transition:"width .6s ease"}}/>
                            </div>
                          </div>
                        );
                      })
                  }
                </div>
              ))}
            </div>

            <div style={{fontSize:14,fontWeight:700,marginBottom:14,color:"#fff"}}>⏱ 予約リードタイム分布（撮影何日前に予約を入れるか）</div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"16px 18px",marginBottom:16}}>
              {d.leadTime.map((lt,i)=>{
                const max = Math.max(...d.leadTime.map(x=>x.count));
                return (
                  <div key={i} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
                      <span style={{color:"rgba(255,255,255,.65)"}}>{lt.range}</span>
                      <span style={{color:lt.color,fontWeight:700}}>{lt.count}件</span>
                    </div>
                    <div style={{height:8,background:"rgba(255,255,255,.08)",borderRadius:99,overflow:"hidden"}}>
                      <div style={{width:`${max>0?lt.count/max*100:0}%`,height:"100%",background:lt.color,borderRadius:99}}/>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              {[
                {icon:"📅",label:"月末時点の充填率",   value:"49〜70%",               color:"#64d9ff",sub:"翌月分の先入り状況"},
                {icon:"⚡",label:"直前予約（〜7日前）",value:`${d.directPct}%`,       color:"#f97316",sub:`実データ${d.totalEvents}件より`},
                {icon:"📆",label:"平均リードタイム",   value:`約${d.avgLead}日前`,     color:"#a78bfa",sub:`中央値${d.medianLead}日`},
                {icon:"🏆",label:"最長リードタイム",   value:`${d.maxLead}日前`,       color:"#34d399",sub:"実績より"},
              ].map((c,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${c.color}25`,borderRadius:12,padding:16}}>
                  <div style={{fontSize:20,marginBottom:8}}>{c.icon}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.45)",marginBottom:4}}>{c.label}</div>
                  <div style={{fontSize:18,fontWeight:800,color:c.color}}>{c.value}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:4}}>{c.sub}</div>
                </div>
              ))}
            </div>
            <div style={{background:"rgba(255,200,100,.08)",border:"1px solid rgba(255,200,100,.25)",borderRadius:12,padding:"14px 18px",fontSize:12,color:"rgba(255,255,255,.65)",lineHeight:1.8}}>
              💡 <strong style={{color:"#ffc864"}}>広告出稿タイミングの目安：</strong>実データでは{d.directPct}%が7日以内の直前予約です。月末時点での翌月充填率は49〜70%で、月初〜中旬に充填率が低い場合は<strong style={{color:"#fff"}}>10〜15日頃に広告強化</strong>が効果的です。
            </div>
          </div>
        )}

        {/* ── プラン分析 ── */}
        {tab==="plans"&&(()=>{
          const planByMonth  = livePlan?.planByMonth ?? STATIC_PLANS;
          const allPlans     = livePlan?.allPlans    ?? Object.values(STATIC_PLANS).reduce((acc,m)=>{ m.plans.forEach(({name,count})=>{ const f=acc.find(a=>a.name===name); f?f.count+=count:acc.push({name,count}); }); return acc; },[]).sort((a,b)=>b.count-a.count);
          const allGender    = livePlan?.allGender   ?? Object.values(STATIC_PLANS).reduce((g,m)=>{ Object.entries(m.genderMap).forEach(([k,v])=>g[k]=(g[k]||0)+v); return g; },{});
          const monthKeys    = Object.keys(planByMonth).sort().reverse();
          const PLAN_COLORS  = ["#64d9ff","#34d399","#ffc864","#a78bfa","#f87171","#f97316","#ec4899","#84cc16","#06b6d4","#8b5cf6"];
          const totalAll     = allPlans.reduce((s,p)=>s+p.count,0);
          const displayPlans = selMonth==="all" ? allPlans : (planByMonth[selMonth]?.plans||[]);
          const displayGender= selMonth==="all" ? allGender : (planByMonth[selMonth]?.genderMap||{});
          const displayTotal = selMonth==="all" ? totalAll  : (planByMonth[selMonth]?.total||0);
          return (
            <div>
              {!livePlan&&(
                <div style={{background:"rgba(167,139,250,.06)",border:"1px solid rgba(167,139,250,.2)",borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:12,color:"rgba(255,255,255,.5)"}}>
                  ⚪ 2025年〜2026年3月は記録済みデータを表示中。「プランを更新」で今月以降のデータを追加取得できます。

                </div>
              )}

              {true&&(
                <>
                  {/* 月選択 */}
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
                    <button onClick={()=>setSelMonth("all")}
                      style={{background:selMonth==="all"?"rgba(255,200,100,.25)":"rgba(255,255,255,.06)",border:`1px solid ${selMonth==="all"?"rgba(255,200,100,.5)":"rgba(255,255,255,.15)"}`,borderRadius:20,padding:"5px 14px",fontSize:12,color:selMonth==="all"?"#ffc864":"rgba(255,255,255,.6)",cursor:"pointer",fontWeight:selMonth==="all"?700:400}}>
                      全期間
                    </button>
                    {monthKeys.map(key=>(
                      <button key={key} onClick={()=>setSelMonth(key)}
                        style={{background:selMonth===key?"rgba(100,217,255,.2)":"rgba(255,255,255,.06)",border:`1px solid ${selMonth===key?"rgba(100,217,255,.5)":"rgba(255,255,255,.15)"}`,borderRadius:20,padding:"5px 14px",fontSize:12,color:selMonth===key?"#64d9ff":"rgba(255,255,255,.6)",cursor:"pointer",fontWeight:selMonth===key?700:400}}>
                        {planByMonth[key].label}
                      </button>
                    ))}
                  </div>

                  {/* 性別・プランCSVコピー */}
                  <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                    <button onClick={()=>{
                      const rows=[["月","男の子","女の子","性別なし","合計"]];
                      Object.entries(planByMonth).sort((a,b)=>a[0]>b[0]?1:-1).forEach(([,m])=>{
                        rows.push([m.label, m.genderMap["男の子"]||0, m.genderMap["女の子"]||0, m.genderMap["性別なし"]||0, m.total]);
                      });
                      setCsvText(rows.map(r=>r.join("\t")).join("\n"));
                    }} style={{background:"rgba(236,72,153,.15)",border:"1px solid rgba(236,72,153,.4)",borderRadius:16,padding:"5px 14px",fontSize:11,color:"#ec4899",cursor:"pointer",fontWeight:700}}>
                      📋 性別集計CSV
                    </button>
                    <button onClick={()=>{
                      const rows=[["月","プラン名","件数"]];
                      Object.entries(planByMonth).sort((a,b)=>a[0]>b[0]?1:-1).forEach(([,m])=>{
                        m.plans.forEach(p=>rows.push([m.label, p.name, p.count]));
                      });
                      setCsvText(rows.map(r=>r.join("\t")).join("\n"));
                    }} style={{background:"rgba(167,139,250,.15)",border:"1px solid rgba(167,139,250,.4)",borderRadius:16,padding:"5px 14px",fontSize:11,color:"#a78bfa",cursor:"pointer",fontWeight:700}}>
                      📋 プラン内訳CSV
                    </button>
                  </div>

                  {/* 性別カード */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
                    {[
                      {label:"男の子",  value:displayGender["男の子"]||0,  color:"#64d9ff"},
                      {label:"女の子",  value:displayGender["女の子"]||0,  color:"#ec4899"},
                      {label:"性別なし",value:displayGender["性別なし"]||0,color:"rgba(255,255,255,.4)"},
                    ].map((g,i)=>{
                      const pct = displayTotal>0 ? Math.round(g.value/displayTotal*100) : 0;
                      return (
                        <div key={i} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${g.color}30`,borderRadius:14,padding:16,textAlign:"center"}}>
                          <div style={{fontSize:11,color:"rgba(255,255,255,.45)",marginBottom:8}}>{g.label}</div>
                          <div style={{fontSize:24,fontWeight:800,color:g.color}}>{g.value}件</div>
                          <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:4}}>{pct}%</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* プラン内訳 */}
                  <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"16px 18px"}}>
                    <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>
                      📋 プラン内訳 <span style={{fontSize:12,color:"rgba(255,255,255,.4)",fontWeight:400}}>（計{displayTotal}件）</span>
                    </div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.35)",marginBottom:16}}>{selMonth==="all"?"2025年〜全期間":planByMonth[selMonth]?.label}</div>
                    {displayPlans.map((p,i)=>{
                      const max = displayPlans[0]?.count||1;
                      const pct = Math.round(p.count/displayTotal*100);
                      const color = PLAN_COLORS[i%PLAN_COLORS.length];
                      return (
                        <div key={i} style={{marginBottom:12}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
                            <span style={{color:"rgba(255,255,255,.75)"}}>{p.name}</span>
                            <span style={{color,fontWeight:700}}>{p.count}件（{pct}%）</span>
                          </div>
                          <div style={{height:8,background:"rgba(255,255,255,.08)",borderRadius:99,overflow:"hidden"}}>
                            <div style={{width:`${p.count/max*100}%`,height:"100%",background:color,borderRadius:99,transition:"width .5s ease"}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* ── 予約履歴 ── */}
        {tab==="history"&&(
          <div>
            {!liveBook&&(
              <div style={{background:"rgba(100,217,255,.06)",border:"1px solid rgba(100,217,255,.2)",borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:12,color:"rgba(255,255,255,.5)"}}>
                ⚪ 記録済みデータを表示中。「カレンダーを更新」でリアルタイムに切り替わります。
              </div>
            )}

            {/* ── 月別予約一覧（2026年1月〜5月） ── */}
            <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:12}}>📋 予約一覧（2026年1月〜5月）</div>
            {[
              {month:"2026年5月",color:"#a78bfa",count:13,bookings:[
                {day:"01",time:"11:00",name:"米倉 綾香",plan:"ハーフバースデー（平日）",price:"¥16,000"},
                {day:"02",time:"10:00",name:"宮國 真菜美",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"03",time:"14:00",name:"奥平 泉",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"06",time:"12:00",name:"横田 花笑",plan:"七五三データプラン",price:"¥28,500"},
                {day:"06",time:"16:00",name:"上原 花澄",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"09",time:"10:00",name:"おくの ゆい",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"09",time:"12:00",name:"軽部 紡希",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"10",time:"10:00",name:"國頭 柚乃",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"13",time:"10:00",name:"大住 友香",plan:"ニューボーンフォト",price:"¥27,000"},
                {day:"16",time:"14:00",name:"知念 ことは",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"23",time:"10:30",name:"山川 結",plan:"マタニティ",price:"¥16,800"},
                {day:"27",time:"10:00",name:"石塚 和香菜",plan:"ニューボーンフォト",price:"¥27,000"},
                {day:"27",time:"14:00",name:"津波古 凜",plan:"2歳バースデープラン（平日）",price:"¥12,000"},
              ]},
              {month:"2026年4月",color:"#64d9ff",count:29,bookings:[
                {day:"01",time:"11:00",name:"城間 晃穂",plan:"マタニティ",price:"¥7,800"},
                {day:"03",time:"10:00",name:"平田 優奈",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"04",time:"12:00",name:"人見 花菜子",plan:"100日フォト（男の子）",price:"¥37,800"},
                {day:"04",time:"14:00",name:"玉城 邑",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"04",time:"16:00",name:"平良 千恵美",plan:"入学フォトプラン",price:"¥40,300"},
                {day:"05",time:"10:00",name:"タバ オウスケ",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"05",time:"12:00",name:"城間 春翔",plan:"1歳バースデーフォト（男の子）",price:"¥24,000"},
                {day:"05",time:"14:00",name:"荻堂 詩祈",plan:"100日フォト（女の子）",price:"¥36,800"},
                {day:"08",time:"10:00",name:"眞田 葵衣",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"10",time:"12:00",name:"宮田 麻亜子",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"10",time:"14:00",name:"那根 夏穂",plan:"1歳バースデーフォト（女の子）",price:"¥24,000"},
                {day:"10",time:"17:00",name:"片桐 政人",plan:"家族写真プラン",price:"¥14,800"},
                {day:"11",time:"10:00",name:"金武 幸音",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"11",time:"12:00",name:"すながわ はれ",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"11",time:"14:00",name:"島袋 美紅",plan:"1歳バースデーフォト（女の子）",price:"¥37,800"},
                {day:"12",time:"10:00",name:"城間 葵",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"12",time:"12:00",name:"宮里 希空",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"12",time:"14:00",name:"舟道 巧人",plan:"七五三データプラン",price:"¥28,500"},
                {day:"12",time:"16:00",name:"舟道 巧人",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"15",time:"12:00",name:"宮城 奈歩",plan:"ハーフバースデー（男の子）",price:"¥35,000"},
                {day:"17",time:"10:00",name:"大谷 昴晴",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"18",time:"12:00",name:"徳嶺 光成仁",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"18",time:"14:00",name:"兼次 野乃花",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"18",time:"16:00",name:"大城 結都",plan:"七五三データプラン",price:"¥28,500"},
                {day:"22",time:"12:00",name:"ケダシロ アンリ",plan:"マタニティ",price:"¥7,800"},
                {day:"24",time:"10:00",name:"与那覇 せんり",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"26",time:"14:00",name:"新垣 わかな",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"26",time:"16:00",name:"原田 萌子",plan:"2歳バースデープラン",price:"¥26,000"},
                {day:"29",time:"10:00",name:"鈴木 春仁",plan:"ニューボーンフォト",price:"¥29,000"},
              ]},
              {month:"2026年3月",color:"#34d399",count:41,bookings:[
                {day:"01",time:"10:00",name:"大城 恵美",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"01",time:"12:00",name:"島袋 汐梨",plan:"七五三データプラン",price:"¥28,500"},
                {day:"04",time:"10:00",name:"宇根 千絢",plan:"1歳バースデーフォト（女の子）",price:"¥25,000"},
                {day:"04",time:"12:00",name:"山城 歩凛",plan:"七五三データプラン",price:"¥28,500"},
                {day:"04",time:"14:00",name:"久高 伶奈",plan:"100日フォト（女の子）",price:"¥25,000"},
                {day:"06",time:"12:00",name:"東恩納 玄",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"06",time:"14:00",name:"井上 翔",plan:"1歳バースデーフォト（男の子）",price:"¥24,000"},
                {day:"07",time:"10:00",name:"飯村 はると",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"07",time:"14:00",name:"石塚 和香菜",plan:"七五三データプラン",price:"¥28,500"},
                {day:"07",time:"16:00",name:"大森 ひなの",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"08",time:"10:00",name:"廣瀬 ふうか・れん",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"08",time:"14:00",name:"新城 ゆな",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"08",time:"16:00",name:"田中 早紀",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"14",time:"10:00",name:"タマシロ アオ",plan:"2歳バースデー(土日)",price:"¥26,000"},
                {day:"14",time:"12:00",name:"山本 麻裕",plan:"七五三データプラン",price:"¥28,500"},
                {day:"14",time:"16:00",name:"當山 瑠愛",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"15",time:"14:00",name:"仲間 絵里香",plan:"1歳バースデーフォト（男の子）",price:"¥25,000"},
                {day:"15",time:"16:00",name:"勝連 里沙",plan:"マタニティ",price:"¥7,800"},
                {day:"18",time:"10:00",name:"波平 優里",plan:"100日フォト（男の子）",price:"¥35,000"},
                {day:"18",time:"14:00",name:"本田 美麗",plan:"七五三アルバムプラン",price:"¥37,500"},
                {day:"19",time:"10:00",name:"仲村渠美穂香",plan:"ニューボーンフォト",price:"¥27,000"},
                {day:"20",time:"10:00",name:"謝花 莉紬",plan:"2歳バースデープラン（平日）",price:"¥12,000"},
                {day:"20",time:"14:00",name:"仲地 正敏",plan:"ハーフバースデー（平日）",price:"¥16,000"},
                {day:"20",time:"16:00",name:"勝連 亜紀",plan:"七五三データプラン",price:"¥28,500"},
                {day:"21",time:"10:00",name:"迫田 夏未",plan:"七五三一面台紙プラン",price:"¥40,300"},
                {day:"21",time:"12:00",name:"渡部 真",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"21",time:"14:00",name:"上地 亜美",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"22",time:"10:00",name:"大城 吉正",plan:"家族写真プラン",price:"¥14,800"},
                {day:"22",time:"12:00",name:"山里 祥盛",plan:"ハーフバースデー（男の子）",price:"¥26,000"},
                {day:"22",time:"14:00",name:"金城 萌恵",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"25",time:"12:00",name:"宮城 希羽",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"25",time:"14:00",name:"長浜 涼花",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"28",time:"10:00",name:"外間 縁",plan:"七五三データプラン",price:"¥28,500"},
                {day:"28",time:"12:00",name:"鈴木 春仁",plan:"2歳バースデープラン",price:"¥26,000"},
                {day:"28",time:"14:00",name:"謝花 ゆき",plan:"入学フォトプラン",price:"¥12,400"},
                {day:"28",time:"15:00",name:"髙原 里奈",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"28",time:"17:30",name:"平井 雅美",plan:"家族写真プラン",price:"¥14,800"},
                {day:"29",time:"10:00",name:"赤嶺 明里",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"29",time:"12:00",name:"宮城 夢乃",plan:"七五三(7歳）",price:"¥37,500"},
                {day:"29",time:"14:00",name:"東里 優澄",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"29",time:"17:00",name:"神里 楓",plan:"マタニティ",price:"¥7,800"},
              ]},
              {month:"2026年2月",color:"#f97316",count:46,bookings:[
                {day:"01",time:"10:00",name:"加藤 ひなみ",plan:"ミルクバスプラン(お湯あり）",price:"¥43,500"},
                {day:"01",time:"12:00",name:"椋木 千翔",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"01",time:"14:00",name:"久米 凪",plan:"100日フォト（女の子）",price:"¥35,000"},
                {day:"01",time:"16:00",name:"藤原 凛音",plan:"100日フォト（女の子）",price:"¥25,000"},
                {day:"04",time:"11:30",name:"ルイズ 海",plan:"研修撮影",price:"¥7,000"},
                {day:"04",time:"12:30",name:"石原 迅",plan:"100日フォト（男の子）",price:"¥34,000"},
                {day:"04",time:"15:00",name:"富永 晏慈",plan:"1歳バースデーフォト（女の子）",price:"¥35,000"},
                {day:"06",time:"13:00",name:"金城 そら",plan:"研修撮影",price:"¥7,000"},
                {day:"06",time:"14:30",name:"山城 愛香",plan:"研修撮影",price:"¥4,000"},
                {day:"07",time:"10:00",name:"石川 蒼和",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"07",time:"12:00",name:"上原 美希",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"07",time:"14:00",name:"翁長 星凪",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"07",time:"16:00",name:"河野 えま",plan:"1歳バースデーフォト（女の子）",price:"¥37,800"},
                {day:"08",time:"10:00",name:"喜屋武 沙弥",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"08",time:"12:00",name:"藤枝 稟",plan:"ミルクバスプラン(お湯あり）",price:"¥34,500"},
                {day:"08",time:"14:00",name:"大内 智徳",plan:"1歳バースデーフォト（男の子）",price:"¥35,000"},
                {day:"08",time:"17:00",name:"宮里 椿",plan:"マタニティ",price:"¥7,800"},
                {day:"11",time:"10:00",name:"玉城 笑夢",plan:"七五三データプラン",price:"¥28,500"},
                {day:"11",time:"12:00",name:"Goya Ayaka",plan:"100日フォト（女の子）",price:"¥37,800"},
                {day:"11",time:"14:00",name:"山城 麻美子",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"11",time:"16:00",name:"松田 敬子",plan:"マタニティ",price:"¥7,800"},
                {day:"13",time:"10:00",name:"前田 和沙",plan:"ハーフバースデー（女の子）",price:"¥35,000"},
                {day:"13",time:"12:00",name:"比屋根 春伽",plan:"ニューボーンフォト",price:"¥29,000"},
                {day:"13",time:"16:00",name:"當山 芽南",plan:"研修撮影",price:"¥7,000"},
                {day:"15",time:"10:00",name:"崎原 紗羽",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"15",time:"12:00",name:"金城 ゆな",plan:"1歳バースデーフォト（女の子）",price:"¥35,000"},
                {day:"15",time:"14:00",name:"きむら めい",plan:"1歳バースデーフォト（女の子）",price:"¥35,000"},
                {day:"15",time:"16:00",name:"湧稲國 莉々",plan:"七五三データプラン",price:"¥28,500"},
                {day:"18",time:"14:00",name:"グリーヴス 久怜藍",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"18",time:"16:00",name:"仲村渠 太惺",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"20",time:"10:00",name:"鉾之原 愛花",plan:"ハーフバースデー（男の子）",price:"¥26,000"},
                {day:"20",time:"12:00",name:"岡崎 叶空",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"20",time:"14:00",name:"プラサッド カホ",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"20",time:"16:00",name:"知念 美香",plan:"マタニティ",price:"¥7,800"},
                {day:"21",time:"09:20",name:"仲村渠美穂香",plan:"マタニティ",price:"¥16,800"},
                {day:"22",time:"10:00",name:"名嘉 友麻",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"22",time:"14:00",name:"田場 陽央羽",plan:"1歳バースデーフォト（男の子）",price:"¥35,000"},
                {day:"22",time:"16:00",name:"元 優陽",plan:"1歳バースデーフォト（男の子）",price:"¥24,000"},
                {day:"25",time:"10:00",name:"大城 咲喜",plan:"マタニティデータプラン",price:"¥7,800"},
                {day:"27",time:"10:00",name:"高良 幸誠",plan:"2歳バースデープラン（平日）",price:"¥12,000"},
                {day:"27",time:"16:00",name:"玉城 陽美子",plan:"2歳バースデープラン（平日）",price:"¥12,000"},
                {day:"28",time:"10:00",name:"新山 翔琉",plan:"七五三データプラン",price:"¥26,500"},
                {day:"28",time:"12:00",name:"真上 麻未",plan:"ハーフバースデー（男の子）",price:"¥26,000"},
                {day:"28",time:"14:00",name:"野原 ことの",plan:"100日フォト（女の子）",price:"¥26,000"},
              ]},
              {month:"2026年1月",color:"#f87171",count:29,bookings:[
                {day:"02",time:"10:00",name:"小橋川 碧奈",plan:"ハーフバースデー（男の子）",price:"¥25,000"},
                {day:"02",time:"12:00",name:"上 侑真",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"02",time:"14:00",name:"新垣 彩晴",plan:"1歳バースデーフォト（女の子）",price:"¥35,000"},
                {day:"03",time:"10:00",name:"須賀 まはな",plan:"七五三データプラン",price:"¥28,500"},
                {day:"03",time:"12:00",name:"新城 智子",plan:"家族写真プラン",price:"¥14,800"},
                {day:"04",time:"10:00",name:"石塚 成生",plan:"ハーフバースデー（男の子）",price:"¥35,000"},
                {day:"04",time:"12:00",name:"當山 碧",plan:"七五三データプラン",price:"¥28,500"},
                {day:"04",time:"14:00",name:"新垣 湊大",plan:"ハーフバースデー（男の子）",price:"¥26,000"},
                {day:"09",time:"12:00",name:"川平 采輝",plan:"ニューボーンフォト",price:"¥29,000"},
                {day:"10",time:"10:00",name:"佐藤 雪乃",plan:"100日フォト（男の子）",price:"¥26,000"},
                {day:"10",time:"12:00",name:"永山 七星",plan:"100日フォト（女の子）",price:"¥35,000"},
                {day:"11",time:"10:00",name:"マキシ エミ",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"11",time:"12:00",name:"杉山 蒼真",plan:"1歳バースデーフォト（男の子）",price:"¥25,000"},
                {day:"14",time:"15:00",name:"金城 麻乃",plan:"マタニティデータプラン",price:"¥5,800"},
                {day:"17",time:"10:00",name:"永綱 茉弥",plan:"ハーフバースデー（女の子）",price:"¥26,000"},
                {day:"17",time:"14:00",name:"新里 凜",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"18",time:"10:00",name:"桑原 えり",plan:"100日フォト（女の子）",price:"¥35,000"},
                {day:"18",time:"12:00",name:"山中 さおり",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"18",time:"16:00",name:"島川 衣利子",plan:"七五三データプラン",price:"¥28,500"},
                {day:"23",time:"12:00",name:"糸数 えま",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"24",time:"14:00",name:"大城 流凪",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"25",time:"10:00",name:"具志堅 和子",plan:"七五三(7歳）",price:"¥37,500"},
                {day:"25",time:"14:00",name:"宮城 鈴奈",plan:"ミルクバス（お湯なし）",price:"¥32,500"},
                {day:"25",time:"16:00",name:"糸数 えま",plan:"100日フォト（女の子）",price:"¥26,000"},
                {day:"30",time:"10:00",name:"岡西 暁史",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"30",time:"12:00",name:"北田 せな",plan:"1歳バースデーフォト（男の子）",price:"¥26,000"},
                {day:"31",time:"10:00",name:"玉城 絵茉",plan:"七五三データプラン",price:"¥27,500"},
                {day:"31",time:"14:00",name:"津秋 知紗",plan:"1歳バースデーフォト（女の子）",price:"¥26,000"},
                {day:"31",time:"16:00",name:"奥間 蘭心",plan:"ハーフバースデー（女の子）",price:"¥26,000"},
              ]},
            ].map((m,mi)=><MonthAccordion key={mi} m={m} defaultOpen={mi===0}/>)
            }

            <div style={{height:24}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>📚 撮影月別 予約フロー履歴</div>
              <button onClick={()=>{
                const rows=[["撮影月","予約タイミング","件数","割合(%)"]];
                bookingFlowAll.forEach(bf=>{
                  if(bf.total===0){rows.push([bf.shootMonth,"予約なし","0","0"]);return;}
                  bf.flow.forEach(f=>rows.push([bf.shootMonth,f.bookedIn,f.count,Math.round(f.count/bf.total*100)]));
                });
                setCsvText(rows.map(r=>r.join("\t")).join("\n"));
              }} style={{background:"rgba(52,211,153,.15)",border:"1px solid rgba(52,211,153,.4)",borderRadius:16,padding:"5px 14px",fontSize:11,color:"#34d399",cursor:"pointer",fontWeight:700}}>
                📋 CSV表示
              </button>
            </div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:16}}>全期間・新しい月が上</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {bookingFlowAll.map((bf,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:"14px 18px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:bf.total>0?12:0}}>
                    <span style={{fontSize:13,fontWeight:700,color:"#ffc864"}}>{bf.shootMonth}</span>
                    <span style={{fontSize:13,fontWeight:800,color:"#64d9ff"}}>{bf.total}件</span>
                  </div>
                  {bf.total===0
                    ? <div style={{fontSize:12,color:"rgba(255,255,255,.3)"}}>予約なし</div>
                    : bf.flow.map((f,j)=>{
                        const pct = Math.round(f.count/bf.total*100);
                        return (
                          <div key={j} style={{marginBottom:8}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                              <span style={{color:"rgba(255,255,255,.6)"}}>{f.bookedIn}に予約</span>
                              <span style={{color:f.color,fontWeight:700}}>{f.count}件（{pct}%）</span>
                            </div>
                            <div style={{height:6,background:"rgba(255,255,255,.08)",borderRadius:99,overflow:"hidden"}}>
                              <div style={{width:`${pct}%`,height:"100%",background:f.color,borderRadius:99}}/>
                            </div>
                          </div>
                        );
                      })
                  }
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 2025年実績 ── */}
        {tab==="rev25"&&(
          <div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:20,marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:18}}>2025年 月別売上（プラン＋グッズ）</div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={data2025} barSize={22}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false}/>
                  <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,.5)",fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"rgba(255,255,255,.5)",fontSize:11}} axisLine={false} tickLine={false} tickFormatter={fmtM} domain={[0,1700000]}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="plan"  name="プラン売上" stackId="a" fill="#64d9ff" radius={[0,0,0,0]}/>
                  <Bar dataKey="goods" name="グッズ売上" stackId="a" fill="#ffc864" radius={[4,4,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
              <div style={{display:"flex",gap:16,justifyContent:"center",marginTop:10}}>
                {[["#64d9ff","プラン売上"],["#ffc864","グッズ売上"]].map(([c,l])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"rgba(255,255,255,.5)"}}>
                    <div style={{width:12,height:12,borderRadius:3,background:c}}/>{l}
                  </div>
                ))}
              </div>
            </div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:"rgba(255,255,255,.05)"}}>
                    {["月","プラン","グッズ","合計","件数","平均単価","グッズ率"].map(h=>(
                      <th key={h} style={{padding:"10px 12px",textAlign:"right",color:"rgba(255,255,255,.5)",fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data2025.map((d,i)=>(
                    <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,.05)"}}>
                      <td style={{padding:"10px 12px",color:"#fff",fontWeight:600}}>{d.month}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",color:"#64d9ff"}}>{fmt(d.plan)}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",color:"#ffc864"}}>{fmt(d.goods)}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",color:"#34d399",fontWeight:700}}>{fmt(d.total)}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",color:"rgba(255,255,255,.6)"}}>{d.qty}件</td>
                      <td style={{padding:"10px 12px",textAlign:"right",color:"rgba(255,255,255,.6)"}}>{fmt(d.avgUnit)}</td>
                      <td style={{padding:"10px 12px",textAlign:"right"}}>
                        <span style={{background:d.goodsRate>=25?"rgba(249,115,22,.2)":"rgba(255,255,255,.08)",color:d.goodsRate>=25?"#f97316":"rgba(255,255,255,.6)",borderRadius:99,padding:"2px 8px",fontSize:11}}>{d.goodsRate}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{borderTop:"2px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.03)"}}>
                    <td style={{padding:"10px 12px",fontWeight:700}}>合計</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:"#64d9ff",fontWeight:700}}>{fmt(data2025.reduce((s,d)=>s+d.plan,0))}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:"#ffc864",fontWeight:700}}>{fmt(data2025.reduce((s,d)=>s+d.goods,0))}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:"#34d399",fontWeight:800}}>{fmt(total2025)}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:"rgba(255,255,255,.6)",fontWeight:700}}>358件</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:"rgba(255,255,255,.6)"}}>¥30,657</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:"rgba(255,255,255,.6)"}}>20.1%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ── 前年比較 ── */}
        {tab==="compare"&&(()=>{
          const compareData = data2025.map(d=>{
            const d26 = d.data2026?.find ? null : d;
            const pred = STATIC.data2026.find(x=>x.month===d.month);
            return {month:d.month, actual2025:d.total, pred2026:pred?.totalPred||null};
          });
          return (
            <div>
              <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:20,marginBottom:16}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>2025年実績 vs 2026年予測（月別）</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:18}}>※2026年は1〜4月のみ（予測値）</div>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={compareData} barGap={4} barSize={16}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false}/>
                    <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,.5)",fontSize:11}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:"rgba(255,255,255,.5)",fontSize:11}} axisLine={false} tickLine={false} tickFormatter={fmtM} domain={[0,1700000]}/>
                    <Tooltip content={<Tip/>}/>
                    <Bar dataKey="actual2025" name="2025年実績" fill="#64d9ff" radius={[4,4,0,0]} opacity={0.7}/>
                    <Bar dataKey="pred2026"   name="2026年予測" fill="#f97316" radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {d.data2026.map((d26,i)=>{
                  const d25=data2025[i]; if(!d25) return null;
                  const diff=d26.totalPred-d25.total, pct=((diff/d25.total)*100).toFixed(1), up=diff>=0;
                  return (
                    <div key={i} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>{d26.month}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>2025実績：{fmt(d25.total)}（{d25.qty}件）</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:15,fontWeight:800,color:"#f97316",marginBottom:4}}>{fmt(d26.totalPred)}（{d26.qty}件）</div>
                        <div style={{background:up?"rgba(52,211,153,.15)":"rgba(248,113,113,.15)",color:up?"#34d399":"#f87171",borderRadius:99,padding:"2px 10px",fontSize:11,fontWeight:700}}>
                          {up?"↑":"↓"} {fmt(Math.abs(diff))}（{up?"+":""}{pct}%）
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── グッズ分析 ── */}
        {tab==="goods"&&(
          <div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:20,marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>月別グッズ上乗せ率（2025年）</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:18}}>プラン売上に対するグッズ売上の割合</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data2025} barSize={22}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false}/>
                  <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,.5)",fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"rgba(255,255,255,.5)",fontSize:11}} axisLine={false} tickLine={false} unit="%" domain={[0,45]}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="goodsRate" name="グッズ率" fill="#a78bfa" radius={[4,4,0,0]}
                    label={{position:"top",fill:"rgba(255,255,255,.5)",fontSize:10,formatter:v=>`${v}%`}}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:20,marginBottom:16}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:18}}>月別 平均客単価（グッズ込み）</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data2025}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false}/>
                  <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,.5)",fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"rgba(255,255,255,.5)",fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`¥${(v/1000).toFixed(0)}K`} domain={[24000,37000]}/>
                  <Tooltip content={<Tip/>}/>
                  <Line dataKey="avgUnit" name="平均単価" stroke="#34d399" strokeWidth={2} dot={{fill:"#34d399",r:4}}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{background:"rgba(167,139,250,.08)",border:"1px solid rgba(167,139,250,.2)",borderRadius:12,padding:"14px 18px",fontSize:12,color:"rgba(255,255,255,.65)",lineHeight:1.8}}>
              💡 <strong style={{color:"#a78bfa"}}>グッズ戦略のヒント：</strong>4月はグッズ率36.2%と最高水準。3月・7月・8月もグッズ率が高く、撮影シーズンに合わせたグッズ提案が効果的です。6月・12月はグッズ率が低めなので、アップセルの余地があります。
            </div>
          </div>
        )}

        {/* ── 2026年予測 ── */}
        {tab==="forecast"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:14,marginBottom:20}}>
              {[
                {label:"1〜4月 予測合計", value:fmt(d.data2026.reduce((s,x)=>s+x.totalPred,0)), sub:"グッズ込み", color:"#f97316"},
                {label:"2025年同期実績",  value:fmt(data2025.slice(0,4).reduce((s,x)=>s+x.total,0)), sub:"1〜4月", color:"#64d9ff"},
                {label:"前年比",          value:"+33.1%", sub:"4ヶ月合計", color:"#34d399"},
                {label:"3月 予測件数",    value:`${d.data2026[2]?.qty||37}件`, sub:liveBook?"ライブ件数":"記録値", color:"#ffc864"},
              ].map((c,i)=>(
                <div key={i} style={card(c.color)}>
                  <div style={bar(c.color)}/>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.45)",marginBottom:8}}>{c.label}</div>
                  <div style={{fontSize:20,fontWeight:800,color:c.color,lineHeight:1}}>{c.value}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:6}}>{c.sub}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
              {d.data2026.map((d26,i)=>{
                const d25=data2025[i]; if(!d25) return null;
                return (
                  <div key={i} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:"16px 18px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>{d26.month}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>予測件数：{d26.qty}件 {liveBook&&<span style={{color:"#34d399"}}>（ライブ）</span>}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:18,fontWeight:800,color:"#f97316"}}>{fmt(d26.totalPred)}</div>
                        <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>2025年同月：{fmt(d25.total)}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {[{label:"プラン",val:fmt(d26.planBase),color:"#64d9ff"},{label:`グッズ（${d25.goodsRate}%）`,val:fmt(d26.goodsPred),color:"#ffc864"}].map(item=>(
                        <div key={item.label} style={{background:"rgba(255,255,255,.05)",borderRadius:8,padding:"6px 12px",fontSize:12}}>
                          <span style={{color:"rgba(255,255,255,.5)"}}>{item.label}：</span>
                          <span style={{color:item.color,fontWeight:700}}>{item.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{background:"rgba(52,211,153,.08)",border:"1px solid rgba(52,211,153,.2)",borderRadius:12,padding:"14px 18px",fontSize:12,color:"rgba(255,255,255,.65)",lineHeight:1.8}}>
              📌 <strong style={{color:"#34d399"}}>予測の前提：</strong>{liveBook?"件数はカレンダーのライブデータを使用。":"件数は3/4時点の記録値。"}グッズ率は2025年同月実績を適用。プランの基本単価は¥26,000で計算。実際はグッズ購入・追加オプションにより上振れする可能性があります。
            </div>
          </div>
        )}

        {tab==="ads"&&(()=>{
          const booked3 = new Set([1,4,6,7,8,11,14,15,18,20,21,22,25,28,29]);
          const booked4 = new Set([4,5,8,10,11,12,18,19,20,21,22,24,25,26,28,29]);
          const booked5 = new Set([1,2,3,6,9,10,13,16,23,24,27,31]);
          // 4月広告（週単位）→ 5月集客にシフト済み
          const ads4 = [
            {day:27,dow:"月",budget:15000,target:"今週（4/27〜5/3）5月GW・バースデー訴求",priority:"highest",weekLabel:"4/27〜5/3"},
          ];
          // 5月広告（週単位）
          const ads5 = [
            {day:4, dow:"月",budget:15000,target:"第2週（5/4〜10）5月後半集客",priority:"highest",weekLabel:"5/4〜10"},
            {day:11,dow:"月",budget:15000,target:"第3週（5/11〜17）5月後半・平日訴求",priority:"high",weekLabel:"5/11〜17"},
            {day:18,dow:"月",budget:12000,target:"第4週（5/18〜24）6月先行・梅雨前訴求",priority:"high",weekLabel:"5/18〜24"},
            {day:25,dow:"月",budget:10000,target:"第5週（5/25〜31）6月集客",priority:"medium",weekLabel:"5/25〜31"},
          ];
          const pc = {
            highest:{color:"#f87171",label:"🔴 最重点"},
            high:   {color:"#f97316",label:"🟠 重点"},
            medium: {color:"#ffc864",label:"🟡 通常"},
            low:    {color:"#64d9ff",label:"🔵 軽め"},
          };
          const renderCal = (month,year,booked,ads,title,budget) => {
            const first = new Date(year,month-1,1).getDay();
            const last  = new Date(year,month,0).getDate();
            const cells = [...Array(first).fill(null),...Array.from({length:last},(_,i)=>i+1)];
            const adMap = {}; ads.forEach(a=>adMap[a.day]=a);
            const weeks = []; for(let i=0;i<cells.length;i+=7) weeks.push(cells.slice(i,i+7));
            return (
              <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:16,marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                  <span style={{fontSize:14,fontWeight:700,color:"#fff"}}>{title}</span>
                  <span style={{fontSize:12,color:"#ffc864",fontWeight:700}}>予算 ¥{budget.toLocaleString()}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
                  {["日","月","火","水","木","金","土"].map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:"rgba(255,255,255,.4)"}}>{d}</div>)}
                </div>
                {weeks.map((w,wi)=>(
                  <div key={wi} style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:2}}>
                    {w.map((d,di)=>{
                      if(!d) return <div key={di}/>;
                      const ad=adMap[d], bk=booked.has(d), isToday=month===3&&d===6;
                      const bg=ad?`${pc[ad.priority].color}18`:bk?"rgba(52,211,153,.15)":"rgba(255,255,255,.03)";
                      const bc=ad?pc[ad.priority].color:bk?"#34d399":"rgba(255,255,255,.08)";
                      const tc=ad?pc[ad.priority].color:bk?"#34d399":di===0?"#f87171":di===6?"#64d9ff":"rgba(255,255,255,.5)";
                      return (
                        <div key={di} style={{background:bg,border:`1px solid ${bc}`,borderRadius:5,padding:"5px 2px",textAlign:"center",minHeight:40}}>
                          <div style={{fontSize:11,fontWeight:isToday?800:400,color:tc}}>{isToday?"▶":""}{d}</div>
                          {bk&&!ad&&<div style={{fontSize:8,color:"#34d399"}}>済</div>}
                          {ad&&<div style={{fontSize:8,color:pc[ad.priority].color,lineHeight:1.1}}>広告<br/>¥{(ad.budget/1000).toFixed(0)}k〜</div>}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div style={{display:"flex",gap:10,marginTop:8,fontSize:10,color:"rgba(255,255,255,.4)",flexWrap:"wrap"}}>
                  <span>🟢 予約済</span><span style={{color:"#f87171"}}>🔴最重点</span><span style={{color:"#f97316"}}>🟠重点</span><span style={{color:"#ffc864"}}>🟡通常</span><span style={{color:"#64d9ff"}}>🔵軽め</span>
                </div>
              </div>
            );
          };
          const total4=ads4.reduce((s,a)=>s+a.budget,0);
          const total5=ads5.reduce((s,a)=>s+a.budget,0);
          return (
            <div>
              <div style={{background:"rgba(52,211,153,.08)",border:"1px solid rgba(52,211,153,.3)",borderRadius:12,padding:"14px 16px",marginBottom:16,fontSize:12,lineHeight:1.9}}>
                <div style={{color:"#34d399",fontWeight:700,marginBottom:8,fontSize:13}}>📊 現状分析（4/29時点）</div>
                <div style={{color:"rgba(255,255,255,.8)",marginBottom:6}}>
                  <strong style={{color:"#fff"}}>① 4月は38件で着地見込み。3月（41件）に迫る好調ぶり。</strong><br/>
                  3/20時点では29件だったが、4月に入ってから+9件追加。<strong style={{color:"#34d399"}}>直前予約層（30%）が機能している</strong>証拠で、広告効果が出ていると判断できる。
                </div>
                <div style={{color:"rgba(255,255,255,.8)",marginBottom:6}}>
                  <strong style={{color:"#fff"}}>② 5月は現在25件。4月と同じパターンで伸ばせる。</strong><br/>
                  4月が3/20時点29件→38件（+9件）だったように、5月も今から広告を打てば同じ上乗せが期待できる。<strong style={{color:"#ffc864"}}>GW・バースデー需要があるため条件は4月より有利。</strong>
                </div>
                <div style={{color:"rgba(255,255,255,.8)"}}>
                  <strong style={{color:"#fff"}}>③ 5月の空き：14〜22日・25〜30日が薄い。</strong><br/>
                  今週から「5月後半の平日枠」を意識した訴求に切り替えることで、<strong style={{color:"#ffc864"}}>5月40件・売上¥100万超えが狙える。</strong>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                {[
                  {label:"4月広告予算（残り）",val:`¥${total4.toLocaleString()}`,sub:"5月GW訴求・今週が最後",color:"#ffc864"},
                  {label:"5月広告予算",val:`¥${total5.toLocaleString()}`,sub:"5月後半＋6月先行",color:"#a78bfa"},
                  {label:"4月の予約（確定）",val:"38件",sub:"3月並み ✅",color:"#34d399"},
                  {label:"5月の予約（現在）",val:"25件",sub:"空き伸びしろあり 📈",color:"#ffc864"},
                ].map((c,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${c.color}28`,borderRadius:12,padding:14}}>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.5)"}}>{c.label}</div>
                    <div style={{fontSize:20,fontWeight:800,color:c.color,margin:"4px 0"}}>{c.val}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.35)"}}>{c.sub}</div>
                  </div>
                ))}
              </div>
              {renderCal(4,2026,booked4,ads4,"4月 広告カレンダー（5月GW訴求・今週が最後）",total4)}
              {renderCal(5,2026,booked5,ads5,"5月 広告カレンダー（5月後半＋6月先行集客）",total5)}
              <div style={{background:"rgba(167,139,250,.06)",border:"1px solid rgba(167,139,250,.2)",borderRadius:12,padding:14,fontSize:12}}>
                <div style={{color:"#a78bfa",fontWeight:700,marginBottom:8}}>💡 週別 訴求メッセージ方針</div>
                <div style={{color:"rgba(255,255,255,.7)",lineHeight:2}}>
                  <div>📣 <strong style={{color:"#ffc864"}}>4/27〜5/3週：</strong>「5月の撮影、まだ空きあります」→ GW中に家族で話題になりやすい。計画層と直前層の両方が動く週。世界観重視のクリエイティブで。</div>
                  <div>📣 <strong style={{color:"#ffc864"}}>5/4〜10週：</strong>「5月後半、バースデーフォトのご予約を」→ GW明けすぐに動く層を狙う。誕生日・100日など具体的なイベントで訴求。</div>
                  <div>📣 <strong style={{color:"#ffc864"}}>5/11〜17週：</strong>「5月後半まだ空きあります／6月も受付中」→ 直前訴求と6月先行を並行。コピーを「残りわずか」に変えると行動喚起が強まる。</div>
                  <div>📣 <strong style={{color:"#ffc864"}}>5/18〜以降：</strong>6月・梅雨前の撮影訴求にシフト。「梅雨前に撮影を」は沖縄ならではの季節感で差別化できる。</div>
                  <div style={{marginTop:4,color:"rgba(255,255,255,.45)",fontSize:11}}>※ 同じクリエイティブを2週以上流し続けると効果が減衰します。最低でもコピー（文言）は週替わりで。</div>
                </div>
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}

// マウント
const container = document.getElementById("dashboard-root");
if (container) {
  createRoot(container).render(<Dashboard />);
}
