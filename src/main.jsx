import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import categoryYamlText from "./data/categories.yml?raw";
import appYamlText from "./data/app.yml?raw";
import campusYamlText from "./data/campuses.yml?raw";
import detailYamlText from "./data/details.yml?raw";
import reactionYamlText from "./data/reactions.yml?raw";
import {
  getSubmissionStatus,
  loadDynamicCatalog,
  mapDynamicPlace,
  submitPlace,
  supabaseConfigured,
} from "./lib/supabase";
import SubmissionForm from "./components/SubmissionForm";
import SubmissionStatus from "./components/SubmissionStatus";
import AdminPanel from "./components/AdminPanel";
import ImageLightbox from "./components/ImageLightbox";
import PlaceReactions from "./components/PlaceReactions";
import RecommendationDrawer from "./components/RecommendationDrawer";
import "./styles.css";

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1);
  if (trimmed.startsWith("[") && trimmed.endsWith("]"))
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => {
        const token = item.trim().replace(/^['"]|['"]$/g, "");
        return /^\d+(\.\d+)?$/.test(token) ? Number(token) : token;
      })
      .filter(Boolean);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseYaml(text) {
  const rows = [];
  let current = null;
  text.split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return;
    if (clean.startsWith("- ")) {
      if (current) rows.push(current);
      current = {};
      const first = clean.slice(2).match(/^([^:]+):\s*(.*)$/);
      if (first) current[first[1].trim()] = parseScalar(first[2]);
      return;
    }
    const match = clean.match(/^([^:]+):\s*(.*)$/);
    if (match && current) current[match[1].trim()] = parseScalar(match[2]);
  });
  if (current) rows.push(current);
  return rows;
}

const appConfig = parseYaml(appYamlText)[0];
if (!appConfig)
  throw new Error("src/data/app.yml must contain one configuration item");
const PI = Math.PI;
const AXIS = 6378245.0;
const EE = 0.00669342162296594323;
const outOfChina = (lng, lat) =>
  lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
const transformLat = (lng, lat) => {
  let ret =
    -100 +
    2 * lng +
    3 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng));
  ret += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3;
  ret += ((20 * Math.sin(lat * PI) + 40 * Math.sin((lat / 3) * PI)) * 2) / 3;
  ret +=
    ((160 * Math.sin((lat / 12) * PI) + 320 * Math.sin((lat * PI) / 30)) * 2) /
    3;
  return ret;
};
const transformLng = (lng, lat) => {
  let ret =
    300 +
    lng +
    2 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng));
  ret += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3;
  ret += ((20 * Math.sin(lng * PI) + 40 * Math.sin((lng / 3) * PI)) * 2) / 3;
  ret +=
    ((150 * Math.sin((lng / 12) * PI) + 300 * Math.sin((lng / 30) * PI)) * 2) /
    3;
  return ret;
};
const wgs84ToGcj02 = ([lng, lat]) => {
  if (outOfChina(lng, lat)) return [lng, lat];
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  const magic = 1 - EE * Math.sin(radLat) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  return [
    lng + (dLng * 180) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI),
    lat + (dLat * 180) / (((AXIS * (1 - EE)) / (magic * sqrtMagic)) * PI),
  ];
};
const toAmapCoordinates = (coordinates) =>
  appConfig.coordinateSystem === "wgs84"
    ? wgs84ToGcj02(coordinates)
    : coordinates;
const hasValidCoordinates = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;
  if (
    coordinates.some(
      (value) => value === null || value === undefined || value === "",
    )
  )
    return false;
  const [longitude, latitude] = coordinates.map(Number);
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
};
const fromAmapCoordinates = (coordinates) => {
  if (appConfig.coordinateSystem !== "wgs84") return coordinates;
  const converted = wgs84ToGcj02(coordinates);
  return [coordinates[0] * 2 - converted[0], coordinates[1] * 2 - converted[1]];
};
const CENTER = toAmapCoordinates(appConfig.mapCenter);
const CAMPUSES = parseYaml(campusYamlText)
  .filter(
    (campus) =>
      campus.id &&
      campus.name &&
      Array.isArray(campus.coordinates) &&
      campus.coordinates.length === 2,
  )
  .map((campus) => ({
    ...campus,
    coordinates: toAmapCoordinates(campus.coordinates),
  }));
if (!CAMPUSES.length)
  throw new Error("src/data/campuses.yml must contain at least one campus");
const DEFAULT_CAMPUS_ID = CAMPUSES[0].id;
const ACTIVE_CAMPUS_STORAGE_KEY = "ahnu-share-map-active-campus";

function getInitialCampusId() {
  try {
    const savedCampusId = window.localStorage.getItem(
      ACTIVE_CAMPUS_STORAGE_KEY,
    );
    return CAMPUSES.some((campus) => campus.id === savedCampusId)
      ? savedCampusId
      : DEFAULT_CAMPUS_ID;
  } catch {
    return DEFAULT_CAMPUS_ID;
  }
}

const distanceBetween = ([lngA, latA], [lngB, latB]) => {
  const earthRadius = 6371000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const detailConfig = parseYaml(detailYamlText).filter(
  (item) => item.key && item.label,
);
const categoryConfig = parseYaml(categoryYamlText)
  .filter((item) => item.id && item.label)
  .map((item) => ({
    id: item.id,
    label: item.label,
    color: item.color || appConfig.defaultCategoryColor,
  }));
const categoryById = Object.fromEntries(
  categoryConfig.map((category) => [category.id, category]),
);
const reactionConfig = parseYaml(reactionYamlText)
  .filter((item) => item.value && item.emoji && item.label)
  .map((item, index) => ({ ...item, sort_order: item.sort_order ?? index }));
const categories = [
  { id: "all", label: appConfig.allCategoryLabel },
  ...categoryConfig,
];

const staticPlaces = [];

function loadAmap(key) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!key) return Promise.reject(new Error("missing-key"));
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-amap-loader]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.AMap));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.dataset.amapLoader = "true";
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.ToolBar,AMap.Scale`;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => reject(new Error("amap-load-failed"));
    document.head.appendChild(script);
  });
}

function AmapCanvas({
  places: visiblePlaces,
  previewPlaces = [],
  selected,
  onSelect,
  onStatus,
  onMapClick,
  onCenterChange,
  debugEnabled,
  resetSignal,
  resetCenter,
  focusPlace,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapClickRef = useRef(onMapClick);
  const centerChangeRef = useRef(onCenterChange);
  const key = import.meta.env.VITE_AMAP_KEY;

  useEffect(() => {
    mapClickRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    centerChangeRef.current = onCenterChange;
  }, [onCenterChange]);

  useEffect(() => {
    let disposed = false;
    loadAmap(key)
      .then((AMap) => {
        if (disposed || mapRef.current) return;
        const map = new AMap.Map(containerRef.current, {
          zoom: appConfig.mapZoom,
          zooms: [appConfig.mapMinZoom, appConfig.mapMaxZoom],
          center: CENTER,
          viewMode: "2D",
          mapStyle: appConfig.mapStyle,
          resizeEnable: true,
        });
        AMap.plugin(["AMap.ToolBar", "AMap.Scale"], () => {
          map.addControl(new AMap.ToolBar({ position: "RB" }));
          map.addControl(new AMap.Scale({ position: "LB" }));
        });
        map.on("click", (event) =>
          mapClickRef.current?.([event.lnglat.getLng(), event.lnglat.getLat()]),
        );
        map.on("moveend", () => {
          const center = map.getCenter();
          centerChangeRef.current?.([center.getLng(), center.getLat()]);
        });
        mapRef.current = map;
        const center = map.getCenter();
        centerChangeRef.current?.([center.getLng(), center.getLat()]);
        onStatus("ready");
      })
      .catch((error) => {
        if (!disposed)
          onStatus(error.message === "missing-key" ? "missing-key" : "error");
      });
    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, [key, onStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.AMap) return;
    map.clearMap();
    [...visiblePlaces, ...previewPlaces]
      .filter((place) => hasValidCoordinates(place.coordinates))
      .forEach((place) => {
        const color = place.pending
          ? "#b36f43"
          : place.color || appConfig.defaultCategoryColor;
        const marker = new window.AMap.Marker({
          position: place.coordinates,
          content: `<span class="dot-marker ${selected?.id === place.id ? "is-active" : ""}" style="--dot-color:${color}"></span>`,
          offset: new window.AMap.Pixel(-9, -9),
          zIndex: selected?.id === place.id ? 120 : 100,
          title: place.name,
        });
        marker.on("click", () =>
          place.pending
            ? map.setZoomAndCenter(appConfig.mapZoom, place.coordinates)
            : onSelect(place),
        );
        map.add(marker);
      });
    if (selected && hasValidCoordinates(selected.coordinates))
      map.setCenter(selected.coordinates);
  }, [visiblePlaces, previewPlaces, selected, onSelect]);

  useEffect(() => {
    if (resetSignal > 0 && mapRef.current)
      mapRef.current.setZoomAndCenter(appConfig.mapZoom, resetCenter);
  }, [resetSignal, resetCenter]);

  useEffect(() => {
    if (focusPlace?.coordinates && hasValidCoordinates(focusPlace.coordinates) && mapRef.current)
      mapRef.current.setZoomAndCenter(
        appConfig.mapZoom,
        focusPlace.coordinates,
      );
  }, [focusPlace]);

  return (
    <div
      ref={containerRef}
      className={`amap-canvas ${debugEnabled ? "is-debugging" : ""}`}
    />
  );
}

const yamlValue = (value) => `'${String(value).replaceAll("'", "''")}'`;

function DebugForm({ draft, setDraft, onClose }) {
  const [copied, setCopied] = useState(false);
  const update = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const updateCustom = (index, key, value) =>
    setDraft((current) => ({
      ...current,
      custom: current.custom.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  const addCustom = () =>
    setDraft((current) => ({
      ...current,
      custom: [...current.custom, { key: "", value: "" }],
    }));
  const removeCustom = (index) =>
    setDraft((current) => ({
      ...current,
      custom: current.custom.filter((_, itemIndex) => itemIndex !== index),
    }));
  const yaml = useMemo(() => {
    const lines = [
      `- name: ${yamlValue(draft.name)}`,
      `  recommendation: ${yamlValue(draft.recommendation)}`,
      `  category: ${draft.category}`,
      `  coordinates: [${draft.latitude}, ${draft.longitude}]`,
    ];
    detailConfig.forEach((field) => {
      if (draft[field.key])
        lines.push(`  ${field.key}: ${yamlValue(draft[field.key])}`);
    });
    draft.custom.forEach((field) => {
      if (field.key.trim() && field.value.trim())
        lines.push(`  ${field.key.trim()}: ${yamlValue(field.value.trim())}`);
    });
    return lines.join("\n");
  }, [draft]);
  const copyYaml = async () => {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside className="debug-panel">
      <div className="drawer-heading">
        <div>
          <p className="section-kicker">MAP DEBUGGER</p>
          <h2>新增推荐点</h2>
        </div>
        <button
          className="drawer-close"
          onClick={onClose}
          aria-label="关闭录点表单"
        >
          ×
        </button>
      </div>
      <div className="debug-form">
        <div className="coordinate-fields">
          <label>
            <span>经度</span>
            <input
              value={draft.longitude}
              onChange={(event) => update("longitude", event.target.value)}
            />
          </label>
          <label>
            <span>纬度</span>
            <input
              value={draft.latitude}
              onChange={(event) => update("latitude", event.target.value)}
            />
          </label>
        </div>
        <label>
          <span>地名 *</span>
          <input
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
            autoFocus
          />
        </label>
        <label>
          <span>推荐理由 *</span>
          <textarea
            value={draft.recommendation}
            onChange={(event) => update("recommendation", event.target.value)}
            rows="4"
          />
        </label>
        <label>
          <span>分类</span>
          <select
            value={draft.category}
            onChange={(event) => update("category", event.target.value)}
          >
            {categoryConfig.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <div className="optional-fields">
          {detailConfig.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              <input
                value={draft[field.key] || ""}
                onChange={(event) => update(field.key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="custom-heading">
          <span>自定义项</span>
          <button type="button" onClick={addCustom}>
            ＋ 添加
          </button>
        </div>
        <div className="custom-fields">
          {draft.custom.map((field, index) => (
            <div className="custom-row" key={index}>
              <input
                placeholder="字段名"
                value={field.key}
                onChange={(event) =>
                  updateCustom(index, "key", event.target.value)
                }
              />
              <input
                placeholder="内容"
                value={field.value}
                onChange={(event) =>
                  updateCustom(index, "value", event.target.value)
                }
              />
              <button
                type="button"
                onClick={() => removeCustom(index)}
                aria-label="删除自定义项"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <textarea
          className="yaml-preview"
          value={yaml}
          readOnly
          rows="7"
          aria-label="生成的 YAML"
        />
        <button
          className="copy-yaml"
          onClick={copyYaml}
          disabled={!draft.name.trim() || !draft.recommendation.trim()}
        >
          {copied ? "已复制" : "复制 YAML"}
        </button>
      </div>
    </aside>
  );
}

function App() {
  const [activeCampusId, setActiveCampusId] = useState(getInitialCampusId);
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [mapStatus, setMapStatus] = useState("loading");
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [adminAddEnabled, setAdminAddEnabled] = useState(false);
  const [draft, setDraft] = useState(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [statusPanel, setStatusPanel] = useState(false);
  const [adminPanel, setAdminPanel] = useState(false);
  const [adminPreviewPlaces, setAdminPreviewPlaces] = useState([]);
  const [adminFocus, setAdminFocus] = useState(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [navigationMenuOpen, setNavigationMenuOpen] = useState(false);
  const activeCampusIndex = CAMPUSES.findIndex(
    (campus) => campus.id === activeCampusId,
  );
  const activeCampus = CAMPUSES[activeCampusIndex >= 0 ? activeCampusIndex : 0];
  const nextCampus = CAMPUSES[(activeCampusIndex + 1) % CAMPUSES.length];
  const [mapCenter, setMapCenter] = useState(activeCampus.coordinates);
  const handlePendingChange = useCallback(
    (items) =>
      setAdminPreviewPlaces(
        items
          .filter((item) =>
            hasValidCoordinates([item.longitude, item.latitude]),
          )
          .map((item) => ({
            id: item.id,
            name: item.name,
            pending: true,
            coordinates: toAmapCoordinates([
              Number(item.longitude),
              Number(item.latitude),
            ]),
          })),
      ),
    [],
  );
  const handlePreviewPlace = useCallback((item) => {
    if (!hasValidCoordinates([item.longitude, item.latitude])) return;
    setAdminFocus({
      id: item.id,
      coordinates: toAmapCoordinates([
        Number(item.longitude),
        Number(item.latitude),
      ]),
    });
  }, []);
  const [catalogPlaces, setCatalogPlaces] = useState(staticPlaces);
  const [catalogCategories, setCatalogCategories] = useState(categoryConfig);
  const [catalogDetailFields, setCatalogDetailFields] = useState(detailConfig);
  const [catalogReactions, setCatalogReactions] = useState(reactionConfig);
  const [dataStatus, setDataStatus] = useState("static");

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_CAMPUS_STORAGE_KEY, activeCampusId);
    } catch {
      // The selected campus still works when browser storage is unavailable.
    }
  }, [activeCampusId]);

  useEffect(() => {
    if (!contactOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setContactOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [contactOpen]);
  useEffect(() => {
    if (window.localStorage.getItem("zheshan-map-guide-seen") !== "1")
      setGuideOpen(true);
  }, []);
  useEffect(() => {
    if (!guideOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        window.localStorage.setItem("zheshan-map-guide-seen", "1");
        setGuideOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [guideOpen]);
  const closeGuide = () => {
    window.localStorage.setItem("zheshan-map-guide-seen", "1");
    setGuideOpen(false);
  };
  const refreshCatalog = useCallback(async () => {
    if (!supabaseConfigured) return;
    try {
      const catalog = await loadDynamicCatalog();
      const nextCategories = (catalog.categories || []).map((category) => ({
        id: category.id,
        label: category.label,
        color: category.color,
      }));
      const nextFields = (catalog.detailFields || []).map((field) => ({
        key: field.key,
        label: field.label,
        default: field.default_value || "",
      }));
      const nextCategoryById = Object.fromEntries(
        nextCategories.map((category) => [category.id, category]),
      );
      const nextReactions = (catalog.reactions || []).map((reaction) => ({
        value: reaction.value,
        emoji: reaction.emoji,
        label: reaction.label,
        sort_order: reaction.sort_order,
      }));
      const summariesByPlace = (catalog.reactionSummaries || []).reduce(
        (summaries, summary) => {
          (summaries[summary.place_id] ||= []).push(summary);
          return summaries;
        },
        {},
      );
      setCatalogCategories(
        nextCategories.length ? nextCategories : categoryConfig,
      );
      setCatalogDetailFields(nextFields.length ? nextFields : detailConfig);
      setCatalogReactions(nextReactions.length ? nextReactions : reactionConfig);
      setCatalogPlaces(
        (catalog.places || []).map((place) => {
          const mapped = mapDynamicPlace(place, nextCategoryById, nextFields);
          return {
            ...mapped,
            coordinates: toAmapCoordinates(mapped.coordinates),
            reactions: summariesByPlace[place.id] || [],
          };
        }),
      );
      setDataStatus("dynamic");
    } catch {
      setDataStatus("error");
    }
  }, []);
  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);
  const categoriesForUi = useMemo(
    () => [
      { id: "all", label: appConfig.allCategoryLabel },
      ...catalogCategories,
    ],
    [catalogCategories],
  );
  const visiblePlaces = useMemo(
    () =>
      catalogPlaces
        .filter((place) => {
          const matchesCategory =
            activeCategory === "all" || place.category === activeCategory;
          const query = search.trim().toLowerCase();
          return (
            matchesCategory &&
            (!query ||
              `${place.name} ${place.address} ${place.tags.join(" ")} ${place.recommendation || ""}`
                .toLowerCase()
                .includes(query))
          );
        }),
    [activeCategory, search, catalogPlaces],
  );
  const filtered = useMemo(
    () =>
      visiblePlaces
        .map((place, index) => ({
          place,
          index,
          distance: distanceBetween(place.coordinates, mapCenter),
        }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .map(({ place }) => place),
    [visiblePlaces, mapCenter],
  );
  const selectPlace = useCallback((place) => {
    setSelected(place);
    setSelectedImageIndex(0);
    setNavigationMenuOpen(false);
    setDrawer(false);
  }, []);
  const createDraft = (coordinates) => {
    if (!debugEnabled && !adminAddEnabled) return;
    const [longitude, latitude] = fromAmapCoordinates(coordinates);
    setSelected(null);
    setDrawer(false);
    const defaultCategory = catalogCategories.some(
      (category) => category.id === appConfig.defaultCategory,
    )
      ? appConfig.defaultCategory
      : catalogCategories[0]?.id || "";
    setDraft({
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      name: "",
      recommendation: "",
      category: defaultCategory,
      custom: [{ key: "", value: "" }],
      ...Object.fromEntries(
        catalogDetailFields.map((field) => [field.key, ""]),
      ),
    });
  };
  const statusMessage =
    mapStatus === "missing-key"
      ? "配置 VITE_AMAP_KEY 后显示高德底图"
      : mapStatus === "error"
        ? "高德地图加载失败，请检查 Key 与域名白名单"
        : dataStatus === "error"
          ? "动态地点加载失败，当前显示本地种子数据"
          : "";
  const selectedImages = selected?.images?.length
    ? selected.images
    : selected?.cover
      ? [selected.cover]
      : [];
  const navigationLinks = useMemo(() => {
    if (!selected?.coordinates) return [];
    const [gcjLongitude, gcjLatitude] = selected.coordinates;
    const [wgsLongitude, wgsLatitude] = fromAmapCoordinates(
      selected.coordinates,
    );
    const destinationName = encodeURIComponent(selected.name);
    return [
      {
        label: "高德",
        href: `https://uri.amap.com/navigation?to=${gcjLongitude},${gcjLatitude},${destinationName}&mode=car&policy=1&coordinate=gaode&callnative=1`,
      },
      {
        label: "腾讯",
        href: `https://apis.map.qq.com/uri/v1/routeplan?type=drive&to=${destinationName}&tocoord=${gcjLatitude},${gcjLongitude}&referer=ahnu-share-map`,
      },
      {
        label: "百度",
        href: `https://api.map.baidu.com/direction?destination=${gcjLatitude},${gcjLongitude}&mode=driving&output=html&coord_type=gcj02&src=ahnu-share-map`,
      },
      {
        label: "苹果",
        href: `https://maps.apple.com/?daddr=${wgsLatitude},${wgsLongitude}&dirflg=d`,
      },
    ];
  }, [selected]);

  return (
    <main className="app-shell">
      <div className="fullscreen-map">
        <AmapCanvas
          places={visiblePlaces}
          previewPlaces={adminPreviewPlaces}
          selected={selected}
          onSelect={selectPlace}
          onStatus={setMapStatus}
          onMapClick={createDraft}
          onCenterChange={setMapCenter}
          debugEnabled={debugEnabled || adminAddEnabled}
          resetSignal={resetSignal}
          resetCenter={activeCampus.coordinates}
          focusPlace={adminFocus}
        />
        <div className="map-fallback" aria-hidden="true" />
      </div>
      <header className="floating-header">
        <div className="brand-lockup">
          <img
            className="brand-mark"
            src="/logo.png"
            alt=""
            draggable="false"
          />
          <div className="brand-copy">
            <p className="eyebrow">AHNU · LIFE MAP</p>
            <h1>安师生活地图</h1>
          </div>
          <div className="brand-actions">
            <button
              className="author-trigger"
              onClick={() => setGuideOpen(true)}
            >
              重看引导
            </button>
            <button
              className="author-trigger"
              onClick={() => setContactOpen(true)}
            >
              联系作者
            </button>
          </div>
        </div>
        <div className="header-actions">
          {supabaseConfigured && (
            <>
              <button
                className="utility-trigger"
                onClick={() => {
                  setStatusPanel(true);
                  setAdminPanel(false);
                  setDraft(null);
                }}
              >
                查投稿
              </button>
              <button
                className="utility-trigger"
                onClick={() => {
                  setAdminPanel(true);
                  setStatusPanel(false);
                  setDraft(null);
                }}
              >
                管理
              </button>
            </>
          )}
          {((supabaseConfigured && appConfig.enablePublicSubmissions) ||
            (!supabaseConfigured && appConfig.enableDebugAddPoint)) && (
            <button
              className={`debug-trigger ${debugEnabled ? "active" : ""}`}
              onClick={() => {
                setDebugEnabled((value) => !value);
                setDraft(null);
              }}
            >
              ＋
              <span>
                {debugEnabled
                  ? "取消加点"
                  : supabaseConfigured
                    ? "投稿地点"
                    : "调试录点"}
              </span>
            </button>
          )}
          <button
            className="drawer-trigger"
            onClick={() => {
              setDrawer(true);
              setSelected(null);
              setDraft(null);
            }}
          >
            <span className="trigger-icon">☷</span>推荐地点{" "}
            <b>{filtered.length}</b>
          </button>
        </div>
      </header>
      <section className="floating-tools">
        <label className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜店面或关键词"
          />
        </label>
        <div className="category-row" role="tablist" aria-label="地点分类">
          {categoriesForUi.map((category) => (
            <button
              key={category.id}
              className={`category-chip ${activeCategory === category.id ? "active" : ""}`}
              onClick={() => setActiveCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
      </section>
      <button
        className="map-stamp"
        onClick={() => {
          setSelected(null);
          setDraft(null);
          setActiveCampusId(nextCampus.id);
          setMapCenter(nextCampus.coordinates);
          setResetSignal((value) => value + 1);
        }}
        title={`切换至${nextCampus.name}`}
      >
        <span>{activeCampus.name}</span>
        <small>点我切换至{nextCampus.name}</small>
      </button>
      {statusMessage && <div className="map-status-note">{statusMessage}</div>}
      <div className="map-legend">
        {catalogCategories.map((category) => (
          <span key={category.id}>
            <i className="legend-dot" style={{ background: category.color }} />
            {category.label}
          </span>
        ))}
      </div>
      {(debugEnabled || adminAddEnabled) && !draft && (
        <div className="debug-hint">点击地图放置新的推荐点</div>
      )}
      {statusPanel && (
        <SubmissionStatus onClose={() => setStatusPanel(false)} />
      )}
      {adminPanel && (
        <AdminPanel
          adminAddEnabled={adminAddEnabled}
          onAdminAddPoint={setAdminAddEnabled}
          onClose={() => {
            setAdminPanel(false);
            setAdminAddEnabled(false);
            setAdminPreviewPlaces([]);
            setAdminFocus(null);
          }}
          onPendingChange={handlePendingChange}
          onPreviewPlace={handlePreviewPlace}
          onDataChanged={refreshCatalog}
        />
      )}
      {draft &&
        (supabaseConfigured ? (
          <SubmissionForm
            draft={draft}
            setDraft={setDraft}
            categories={categoriesForUi}
            detailFields={catalogDetailFields}
            adminMode={adminAddEnabled}
            onSubmitted={() => refreshCatalog()}
            onClose={() => {
              setDraft(null);
              if (adminAddEnabled) setAdminAddEnabled(false);
            }}
          />
        ) : (
          <DebugForm
            draft={draft}
            setDraft={setDraft}
            onClose={() => setDraft(null)}
          />
        ))}
      {drawer && (
        <RecommendationDrawer
          places={filtered}
          selectedPlaceId={selected?.id}
          defaultRating={appConfig.defaultRating}
          onClose={() => setDrawer(false)}
          onSelectPlace={selectPlace}
        />
      )}
      {selected && (
        <div
          className={`detail-drawer ${selectedImages.length ? "" : "no-image"}`}
        >
          <button
            className="drawer-close"
            onClick={() => setSelected(null)}
            aria-label="关闭详情"
          >
            ×
          </button>
          {selectedImages.length > 0 && (
            <div className="detail-media">
              <button
                className="drawer-image image-zoom-trigger"
                style={{
                  backgroundImage: `url(${selectedImages[selectedImageIndex] || selectedImages[0]})`,
                }}
                onClick={() =>
                  setLightboxImage(
                    selectedImages[selectedImageIndex] || selectedImages[0],
                  )
                }
                aria-label="查看大图"
              />
              {selectedImages.length > 1 && (
                <>
                  <button
                    className="gallery-nav gallery-prev"
                    onClick={() =>
                      setSelectedImageIndex(
                        (index) =>
                          (index - 1 + selectedImages.length) %
                          selectedImages.length,
                      )
                    }
                    aria-label="上一张图片"
                  >
                    ‹
                  </button>
                  <button
                    className="gallery-nav gallery-next"
                    onClick={() =>
                      setSelectedImageIndex(
                        (index) => (index + 1) % selectedImages.length,
                      )
                    }
                    aria-label="下一张图片"
                  >
                    ›
                  </button>
                  <div className="gallery-dots">
                    {selectedImages.map((image, index) => (
                      <button
                        key={image}
                        className={index === selectedImageIndex ? "active" : ""}
                        onClick={() => setSelectedImageIndex(index)}
                        aria-label={`查看第${index + 1}张图片`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="drawer-content">
            <div className="drawer-meta">
              <span
                className="place-category"
                style={{ background: selected.color }}
              >
                {selected.categoryLabel}
              </span>
              {selected.rating !== appConfig.defaultRating && (
                <span>★ {selected.rating}</span>
              )}
            </div>
            <h2>{selected.name}</h2>
            <p className="drawer-address">{selected.address}</p>
            {navigationLinks.length > 0 && (
              <button
                type="button"
                className="mobile-navigation-trigger"
                onClick={() => setNavigationMenuOpen(true)}
              >
                一键导航
              </button>
            )}
            <div className="detail-grid">
              {selected.details.map((detail) => (
                <div key={detail.key}>
                  <span>{detail.label}</span>
                  <strong>{detail.value}</strong>
                </div>
              ))}
            </div>
            <div className="senior-note">
              <div className="avatar">学</div>
              <div>
                <span className="note-label">学长说</span>
                <p>{selected.recommendation}</p>
              </div>
            </div>
            <PlaceReactions
              key={selected.id}
              placeId={selected.id}
              reactions={catalogReactions}
            />
            {selected.highlights.length > 0 && (
              <div className="highlight-list">
                {selected.highlights.map((item) => (
                  <span key={item}>✓ {item}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {navigationMenuOpen && navigationLinks.length > 0 && (
        <div
          className="navigation-popover-backdrop"
          role="presentation"
          onClick={() => setNavigationMenuOpen(false)}
        >
          <section
            className="navigation-popover"
            role="dialog"
            aria-modal="true"
            aria-label="选择导航软件"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="navigation-popover-close"
              onClick={() => setNavigationMenuOpen(false)}
              aria-label="关闭导航软件选择"
            >
              ×
            </button>
            <div className="navigation-popover-options">
              {navigationLinks.map((link) => (
                <a key={link.label} href={link.href}>
                  {link.label}
                </a>
              ))}
            </div>
          </section>
        </div>
      )}
      {contactOpen && (
        <div
          className="author-modal-backdrop"
          role="presentation"
          onClick={() => setContactOpen(false)}
        >
          <section
            className="author-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="author-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="author-close"
              onClick={() => setContactOpen(false)}
              aria-label="关闭联系作者"
            >
              ×
            </button>
            <p className="section-kicker">CONTACT</p>
            <h2 id="author-dialog-title">联系作者</h2>
            <div className="author-detail">
              <span>QQ</span>
              <strong><a href="https://qm.qq.com/q/RpYQ0TADOW " target="_blank" rel="noreferrer">
                3393314989
              </a></strong>
            </div>
            <div className="author-detail">
              <span>QQ 群</span>
              <strong><a href="https://qm.qq.com/q/mjcBzVPf90" target="_blank" rel="noreferrer">
                1094990582
              </a></strong>
            </div>
            <div className="author-detail">
              <span>个人主页</span>
              <a href="https://florance.top" target="_blank" rel="noreferrer">
                Florance.top ↗
              </a>
            </div>
            <div className="author-detail">
              <span>GitHub</span>
              <a href="https://github.com/floranceyeh" target="_blank" rel="noreferrer">
                FloranceYeh ↗
              </a>
            </div>
          </section>
        </div>
      )}
      {guideOpen && (
        <div
          className="guide-modal-backdrop"
          role="presentation"
          onClick={closeGuide}
        >
          <section
            className="guide-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="author-close"
              onClick={closeGuide}
              aria-label="关闭使用引导"
            >
              ×
            </button>
            <p className="section-kicker">QUICK START</p>
            <h2 id="guide-dialog-title">三步开始逛安师</h2>
            <ol className="guide-steps">
              <li>
                <b>1</b>
                <div>
                  <strong>搜索或筛选</strong>
                  <span>输入店名，或选择分类快速找到目标地点。</span>
                </div>
              </li>
              <li>
                <b>2</b>
                <div>
                  <strong>打开推荐</strong>
                  <span>点击地图圆点，查看学长分享的具体理由和详情。</span>
                </div>
              </li>
              <li>
                <b>3</b>
                <div>
                  <strong>分享新发现</strong>
                  <span>点击加号投稿，在地图上选点并提交你的推荐。</span>
                </div>
              </li>
            </ol>
            <button className="copy-yaml guide-confirm" onClick={closeGuide}>
              开始探索
            </button>
          </section>
        </div>
      )}
      <ImageLightbox
        src={lightboxImage}
        alt={selected?.name || "地点图片"}
        onClose={() => setLightboxImage("")}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
