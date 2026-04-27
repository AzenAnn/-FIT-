const SUN_YAT_SEN_UNIVERSITY_CENTER = [23.0964, 113.2988];
const DEFAULT_MAP_ZOOM = 16;

const map = L.map("map").setView(
  SUN_YAT_SEN_UNIVERSITY_CENTER,
  DEFAULT_MAP_ZOOM
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let routePoints = [];
let polyline = null;
let paceChart = null;
let hrChart = null;
let previewData = null;
let previewTimer = null;
let previewIndex = 0;
let previewMarker = null;

function updateMessage(text, isError = false) {
  const el = document.getElementById("message");
  el.textContent = text || "";
  el.className = "message" + (isError ? " error" : "");
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeDistanceMeters(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }
  return total;
}

function updateDistanceInfo() {
  const el = document.getElementById("distanceInfo");
  if (!el) return;
  if (!routePoints || routePoints.length < 2) {
    el.textContent = "总距离约：0 公里";
    return;
  }
  const baseMeters = computeDistanceMeters(routePoints);
  const baseKm = baseMeters / 1000;
  const lapInput = document.getElementById("lapCount");
  const laps = Math.max(1, parseInt(lapInput?.value, 10) || 1);
  const totalKm = baseKm * laps;
  const baseStr = baseKm.toFixed(2);
  const totalStr = totalKm.toFixed(2);
  if (laps > 1) {
    el.textContent = `总距离约：${totalStr} 公里（基础：${baseStr} 公里 × ${laps} 圈）`;
  } else {
    el.textContent = `总距离约：${baseStr} 公里`;
  }
}

map.on("click", (e) => {
  routePoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
  if (polyline) {
    polyline.setLatLngs(routePoints);
  } else {
    polyline = L.polyline(routePoints, { color: "#ff5722" }).addTo(map);
  }
  updateMessage(`已添加点数：${routePoints.length}`);
  updateDistanceInfo();
});

const clearBtn = document.getElementById("clearRoute");
clearBtn.addEventListener("click", () => {
  routePoints = [];
  if (polyline) {
    map.removeLayer(polyline);
    polyline = null;
  }
  updateMessage("轨迹已清除");
  updateDistanceInfo();
});

function dateToLocalInputValue(d) {
  const tzOffset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 16);
}

function rebuildExportTimes() {
  const container = document.getElementById("exportTimes");
  const exportInput = document.getElementById("exportCount");
  if (!container || !exportInput) return;

  const count = Math.max(1, Math.min(10, parseInt(exportInput.value, 10) || 1));
  const now = new Date();

  container.innerHTML = "";

  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "export-time-row";

    const label = document.createElement("span");
    label.textContent = `第 ${i + 1} 份`;

    const timeInput = document.createElement("input");
    timeInput.type = "datetime-local";
    timeInput.className = "export-time-input";
    timeInput.dataset.index = String(i);
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    timeInput.value = dateToLocalInputValue(d);

    const paceMinInput = document.createElement("input");
    paceMinInput.type = "number";
    paceMinInput.className = "export-pace-min";
    paceMinInput.min = "0";
    paceMinInput.step = "0.1";
    paceMinInput.value = "6";

    const paceSecInput = document.createElement("input");
    paceSecInput.type = "number";
    paceSecInput.className = "export-pace-sec";
    paceSecInput.min = "0";
    paceSecInput.max = "59.9";
    paceSecInput.step = "0.1";
    paceSecInput.value = "0";

    row.appendChild(label);
    row.appendChild(timeInput);
    row.appendChild(paceMinInput);
    row.appendChild(paceSecInput);
    container.appendChild(row);
  }
}

async function generateFit() {
  if (routePoints.length < 2) {
    updateMessage("请至少在地图上选择两个点形成轨迹", true);
    return;
  }

  const hrRest = parseInt(document.getElementById("hrRest").value, 10) || 60;
  const hrMax = parseInt(document.getElementById("hrMax").value, 10) || 180;

  const lapInput = document.getElementById("lapCount");
  const exportInput = document.getElementById("exportCount");
  const lapCount = Math.max(1, parseInt(lapInput?.value, 10) || 1);
  const exportCount = Math.max(
    1,
    Math.min(10, parseInt(exportInput?.value, 10) || 1)
  );

  const exportTimesContainer = document.getElementById("exportTimes");
  const timeInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-time-input"))
    : [];
  const paceMinInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-min"))
    : [];
  const paceSecInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-sec"))
    : [];

  if (timeInputs.length < exportCount || paceMinInputs.length < exportCount || paceSecInputs.length < exportCount) {
    updateMessage("导出份数与时间/配速行数不一致", true);
    return;
  }

  try {
    for (let i = 0; i < exportCount; i++) {
      updateMessage(`正在生成第 ${i + 1}/${exportCount} 个 FIT 文件，请稍候...`);

      const input = timeInputs[i];
      if (!input || !input.value) {
        updateMessage(`请为第 ${i + 1} 份设置开始日期时间`, true);
        return;
      }
      const fileStart = new Date(input.value);
      if (Number.isNaN(fileStart.getTime())) {
        updateMessage(`第 ${i + 1} 份的开始时间无效`, true);
        return;
      }

      const paceMinInput = paceMinInputs[i];
      const paceSecInput = paceSecInputs[i];
      if (paceMinInput && paceSecInput) {
        const pm = parseFloat(paceMinInput.value);
        const ps = parseFloat(paceSecInput.value);
        const sec = (Number.isFinite(pm) ? pm : 0) * 60 +
          (Number.isFinite(ps) ? ps : 0);
        if (!sec || sec <= 0) {
          updateMessage(`第 ${i + 1} 份的配速无效`, true);
          return;
        }

        var filePaceSecondsPerKm = sec;
      }

      const res = await fetch("/api/generate-fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: fileStart.toISOString(),
          points: routePoints,
          paceSecondsPerKm: filePaceSecondsPerKm,
          hrRest,
          hrMax,
          lapCount,
          variantIndex: i + 1
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        updateMessage(err.error || "生成失败", true);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportCount > 1 ? `run_${i + 1}.fit` : "run.fit";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    }
    updateMessage(`已生成 ${exportCount} 个 FIT 文件并开始下载`);
  } catch (e) {
    console.error(e);
    updateMessage("请求失败，请稍后重试", true);
  }
}

const genBtn = document.getElementById("generateFit");
genBtn.addEventListener("click", generateFit);

const lapInputInit = document.getElementById("lapCount");
if (lapInputInit) {
  lapInputInit.addEventListener("input", updateDistanceInfo);
}
const exportInputInit = document.getElementById("exportCount");
if (exportInputInit) {
  exportInputInit.addEventListener("input", rebuildExportTimes);
}
updateDistanceInfo();
rebuildExportTimes();

function renderPreviewCharts(preview) {
  if (!preview || !Array.isArray(preview.samples) || preview.samples.length === 0) {
    updateMessage("预览数据为空", true);
    return;
  }

  const labels = preview.samples.map((s) => (s.timeSec / 60).toFixed(1));
  const paceData = preview.samples.map((s) => {
    const speed = s.speed > 0 ? s.speed : 0.01;
    const secPerKm = 1000 / speed;
    return secPerKm / 60;
  });
  const hrData = preview.samples.map((s) => s.heartRate);

  const paceCtx = document.getElementById("paceChart").getContext("2d");
  const hrCtx = document.getElementById("hrChart").getContext("2d");

  if (paceChart) paceChart.destroy();
  if (hrChart) hrChart.destroy();

  paceChart = new Chart(paceCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "配速 (min/km)",
          data: paceData,
          borderColor: "#1976d2",
          tension: 0.2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          title: { display: true, text: "时间 (分钟)" }
        },
        y: {
          title: { display: true, text: "min/km" },
          reverse: true
        }
      }
    }
  });

  hrChart = new Chart(hrCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "心率 (bpm)",
          data: hrData,
          borderColor: "#e53935",
          tension: 0.2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          title: { display: true, text: "时间 (分钟)" }
        },
        y: {
          title: { display: true, text: "bpm" }
        }
      }
    }
  });
}

async function previewActivity() {
  if (routePoints.length < 2) {
    updateMessage("请至少在地图上选择两个点形成轨迹", true);
    return;
  }

  const exportTimesContainer = document.getElementById("exportTimes");
  const timeInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-time-input"))
    : [];
  const paceMinInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-min"))
    : [];
  const paceSecInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-sec"))
    : [];

  if (!timeInputs.length || !paceMinInputs.length || !paceSecInputs.length) {
    updateMessage("请先在导出列表中设置至少一份的时间和配速", true);
    return;
  }

  const firstTimeInput = timeInputs[0];
  if (!firstTimeInput.value) {
    const now = new Date();
    firstTimeInput.value = dateToLocalInputValue(now);
  }
  const start = new Date(firstTimeInput.value);
  if (Number.isNaN(start.getTime())) {
    updateMessage("预览使用的开始时间无效", true);
    return;
  }

  const firstPaceMinInput = paceMinInputs[0];
  const firstPaceSecInput = paceSecInputs[0];
  const pm = parseFloat(firstPaceMinInput.value);
  const ps = parseFloat(firstPaceSecInput.value);
  const paceSecondsPerKm = (Number.isFinite(pm) ? pm : 0) * 60 +
    (Number.isFinite(ps) ? ps : 0);
  if (!paceSecondsPerKm || paceSecondsPerKm <= 0) {
    updateMessage("预览使用的配速无效", true);
    return;
  }

  const hrRest = parseInt(document.getElementById("hrRest").value, 10) || 60;
  const hrMax = parseInt(document.getElementById("hrMax").value, 10) || 180;

  const lapInput = document.getElementById("lapCount");
  const lapCount = Math.max(1, parseInt(lapInput?.value, 10) || 1);

  updateMessage("正在生成预览，请稍候...");

  try {
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startTime: start.toISOString(),
        points: routePoints,
        paceSecondsPerKm,
        hrRest,
        hrMax,
        lapCount
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      updateMessage(err.error || "预览失败", true);
      return;
    }

    const data = await res.json();
    renderPreviewCharts(data);

    const km = (data.totalDistanceMeters / 1000).toFixed(2);
    const min = (data.totalDurationSec / 60).toFixed(1);
    updateMessage(`预览已生成，总距离约 ${km} 公里，总时间约 ${min} 分钟`);
    previewData = data;
    previewIndex = 0;
    if (previewTimer) {
      clearInterval(previewTimer);
      previewTimer = null;
    }
    if (previewMarker) {
      map.removeLayer(previewMarker);
      previewMarker = null;
    }
    const samples = previewData.samples || [];
    if (samples.length > 0) {
      const first = samples[0];
      previewMarker = L.circleMarker([first.lat, first.lng], {
        radius: 6,
        color: "#1976d2"
      }).addTo(map);
      startPreviewPlayback();
    }
  } catch (e) {
    console.error(e);
    updateMessage("预览请求失败，请稍后重试", true);
  }
}

const previewBtn = document.getElementById("previewBtn");
if (previewBtn) {
  previewBtn.addEventListener("click", previewActivity);
}

function updateLiveInfo(sample) {
  const el = document.getElementById("liveInfo");
  if (!el || !sample) return;
  const t = Math.max(0, sample.timeSec || 0);
  const min = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  const speed = sample.speed > 0 ? sample.speed : 0.01;
  const secPerKm = 1000 / speed;
  const paceMin = Math.floor(secPerKm / 60);
  const paceSec = Math.round(secPerKm % 60);
  const paceStr = `${paceMin}'${paceSec.toString().padStart(2, "0")}"/km`;
  const hr = sample.heartRate || 0;
  el.textContent = `时间 ${min}:${sec.toString().padStart(2, "0")}  配速 ${paceStr}  心率 ${hr} bpm`;
}

function startPreviewPlayback() {
  const samples = previewData?.samples || [];
  if (!samples.length) return;

  const totalSamples = samples.length;
  const stepMs = 100;
  previewIndex = 0;

  if (previewTimer) {
    clearInterval(previewTimer);
  }

  previewTimer = setInterval(() => {
    if (previewIndex >= totalSamples) {
      clearInterval(previewTimer);
      previewTimer = null;
      return;
    }
    const s = samples[previewIndex];
    if (previewMarker && s.lat != null && s.lng != null) {
      previewMarker.setLatLng([s.lat, s.lng]);
    }
    updateLiveInfo(s);
    previewIndex += 1;
  }, stepMs);
}
