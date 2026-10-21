const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const STORAGE_KEY = "weather-now-units";
const SEARCH_DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;
const SUGGESTION_LIMIT = 5;
const FORECAST_DAYS = 7;
const SKELETON_HOURS = 8;
const SKELETON_DAYS = 7;
const KM_TO_MPH = 0.621371;
const MM_TO_INCH = 0.0393701;
const ICON_PATH = "./assets/images/";

const METRIC_UNITS = {
  temperature: "celsius",
  wind: "kmh",
  precipitation: "mm",
};

const IMPERIAL_UNITS = {
  temperature: "fahrenheit",
  wind: "mph",
  precipitation: "inch",
};

const DEFAULT_PLACE = {
  name: "Saran",
  country: "Palani",
  admin1: "",
  latitude: 52.52,
  longitude: 13.41,
};

const WEATHER_TYPES = [
  { test: (code) => code === 0, label: "Clear sky", icon: "icon-sunny.webp" },
  {
    test: (code) => code === 1,
    label: "Mainly clear",
    icon: "icon-sunny.webp",
  },
  {
    test: (code) => code === 2,
    label: "Partly cloudy",
    icon: "icon-partly-cloudy.webp",
  },
  { test: (code) => code === 3, label: "Overcast", icon: "icon-overcast.webp" },
  {
    test: (code) => code === 45 || code === 48,
    label: "Fog",
    icon: "icon-fog.webp",
  },
  {
    test: (code) => code >= 51 && code <= 57,
    label: "Drizzle",
    icon: "icon-drizzle.webp",
  },
  {
    test: (code) => (code >= 61 && code <= 67) || (code >= 80 && code <= 82),
    label: "Rain",
    icon: "icon-rain.webp",
  },
  {
    test: (code) => (code >= 71 && code <= 77) || code === 85 || code === 86,
    label: "Snow",
    icon: "icon-snow.webp",
  },
  {
    test: (code) => code >= 95,
    label: "Thunderstorm",
    icon: "icon-storm.webp",
  },
];

const state = {
  units: loadUnits(),
  place: DEFAULT_PLACE,
  weather: null,
  view: "loading",
  selectedDay: 0,
  suggestions: [],
  suggestionQuery: "",
  activeSuggestion: -1,
};

const dom = {
  units: document.querySelector("#units"),
  unitsToggle: document.querySelector(".units__toggle"),
  unitsMenu: document.querySelector("#units-menu"),
  unitsSwitch: document.querySelector("#units-switch"),
  intro: document.querySelector("#intro"),
  form: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  searchPanel: document.querySelector("#search-panel"),
  empty: document.querySelector("#empty-state"),
  error: document.querySelector("#error-state"),
  retry: document.querySelector("#retry-button"),
  dashboard: document.querySelector("#dashboard"),
  hero: document.querySelector("#hero"),
  metrics: document.querySelector("#metrics"),
  daily: document.querySelector("#daily"),
  hourly: document.querySelector("#hourly"),
  status: document.querySelector("#status"),
};

let searchTimer = 0;
let searchToken = 0;
let weatherController = null;
let suggestionController = null;

init();

function init() {
  updateUnitsMenu();
  bindEvents();
  renderView();
  loadWeather(DEFAULT_PLACE);
}

function bindEvents() {
  dom.unitsToggle.addEventListener("click", toggleUnitsMenu);
  dom.unitsSwitch.addEventListener("click", switchUnitSystem);
  dom.unitsMenu.addEventListener("click", onUnitOption);
  dom.form.addEventListener("submit", onSearchSubmit);
  dom.searchInput.addEventListener("input", onSearchInput);
  dom.searchInput.addEventListener("keydown", onSearchKeydown);
  dom.retry.addEventListener("click", () => loadWeather(state.place));
  dom.hourly.addEventListener("click", onHourlyClick);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
}

function toggleUnitsMenu(event) {
  event.stopPropagation();
  const open = dom.unitsToggle.getAttribute("aria-expanded") === "true";
  setUnitsOpen(!open);
}

function setUnitsOpen(open) {
  dom.unitsToggle.setAttribute("aria-expanded", String(open));
  dom.unitsMenu.hidden = !open;
}

function switchUnitSystem() {
  state.units = isFullyImperial() ? { ...METRIC_UNITS } : { ...IMPERIAL_UNITS };
  persistUnits();
  updateUnitsMenu();
  if (state.view === "ready") renderWeather();
}

function onUnitOption(event) {
  const option = event.target.closest("[data-unit]");
  if (!option) return;
  state.units[option.dataset.unit] = option.dataset.value;
  persistUnits();
  updateUnitsMenu();
  if (state.view === "ready") renderWeather();
}

function onSearchSubmit(event) {
  event.preventDefault();
  const query = dom.searchInput.value.trim();
  if (!query) return;

  const canUseSuggestions =
    isSearchOpen() &&
    state.suggestionQuery === query &&
    state.suggestions.length;
  if (canUseSuggestions) {
    selectPlace(
      state.suggestions[state.activeSuggestion] || state.suggestions[0],
    );
    return;
  }

  submitQuery(query);
}

function onSearchInput() {
  window.clearTimeout(searchTimer);
  const query = dom.searchInput.value.trim();
  state.activeSuggestion = -1;

  if (query.length < MIN_QUERY_LENGTH) {
    closeSearch();
    if (!query && state.weather) {
      state.view = "ready";
      renderView();
    }
    return;
  }

  searchTimer = window.setTimeout(
    () => loadSuggestions(query),
    SEARCH_DEBOUNCE_MS,
  );
}

function onSearchKeydown(event) {
  if (!isSearchOpen() || !state.suggestions.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSuggestion(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSuggestion(-1);
  }
}

function onHourlyClick(event) {
  const toggle = event.target.closest("[data-day-toggle]");
  if (toggle) {
    event.stopPropagation();
    const menu = dom.hourly.querySelector(".day-menu");
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    if (menu) menu.hidden = open;
    return;
  }

  const option = event.target.closest("[data-day-index]");
  if (!option) return;
  state.selectedDay = Number(option.dataset.dayIndex);
  renderHourly();
}

function onDocumentClick(event) {
  if (!dom.units.contains(event.target)) setUnitsOpen(false);
  if (!event.target.closest(".search__field")) closeSearch();
  if (!event.target.closest(".day-picker")) closeDayMenu();
}

function onDocumentKeydown(event) {
  if (event.key !== "Escape") return;
  setUnitsOpen(false);
  closeSearch();
  closeDayMenu();
}

async function loadSuggestions(query) {
  const token = ++searchToken;
  suggestionController?.abort();
  suggestionController = new AbortController();
  showSearchProgress();

  try {
    const places = await geocode(query, suggestionController.signal);
    if (token !== searchToken || dom.searchInput.value.trim() !== query) return;
    state.suggestions = places;
    renderSuggestions(places);
  } catch (error) {
    if (error.name === "AbortError" || token !== searchToken) return;
    closeSearch();
  }
}

async function submitQuery(query) {
  suggestionController?.abort();
  showSearchProgress();

  try {
    const places = await geocode(query);
    state.suggestions = places;
    if (!places.length) {
      closeSearch();
      state.view = "empty";
      renderView();
      setStatus("No search result found.");
      return;
    }
    selectPlace(places[0]);
  } catch (error) {
    if (error.name === "AbortError") return;
    closeSearch();
    state.view = "error";
    renderView();
    setStatus("Unable to search for that place.");
  }
}

function selectPlace(place) {
  dom.searchInput.value = "";
  closeSearch();
  loadWeather(place);
}

async function loadWeather(place) {
  weatherController?.abort();
  const controller = new AbortController();
  weatherController = controller;
  state.place = place;
  state.selectedDay = 0;
  state.view = "loading";
  renderView();

  try {
    const data = await fetchJson(forecastUrl(place), controller.signal);
    state.weather = normalizeWeather(data);
    state.view = "ready";
    renderView();
    setStatus(`Showing weather for ${placeLabel(place)}.`);
    document.title = `${placeLabel(place)} | Weather Now`;
  } catch (error) {
    if (error.name === "AbortError") return;
    state.view = "error";
    renderView();
    setStatus("Unable to load weather data.");
  }
}

async function geocode(query, signal) {
  const params = new URLSearchParams({
    name: query,
    count: String(SUGGESTION_LIMIT),
    language: "en",
    format: "json",
  });
  const data = await fetchJson(`${GEOCODING_API}?${params}`, signal);
  return (data.results || []).map(toPlace);
}

function forecastUrl(place) {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
    hourly: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
  });
  return `${FORECAST_API}?${params}`;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
}

function toPlace(result) {
  return {
    name: result.name,
    country: result.country || "",
    admin1: result.admin1 || "",
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

function normalizeWeather(data) {
  const days = data.daily.time.map((date, index) => ({
    date,
    code: data.daily.weather_code[index],
    max: data.daily.temperature_2m_max[index],
    min: data.daily.temperature_2m_min[index],
  }));

  const hours = data.hourly.time.map((time, index) => ({
    time,
    date: time.slice(0, 10),
    hour: Number(time.slice(11, 13)),
    temp: data.hourly.temperature_2m[index],
    code: data.hourly.weather_code[index],
  }));

  return {
    current: {
      time: data.current.time,
      temperature: data.current.temperature_2m,
      feelsLike: data.current.apparent_temperature,
      humidity: data.current.relative_humidity_2m,
      wind: data.current.wind_speed_10m,
      precipitation: data.current.precipitation,
      code: data.current.weather_code,
    },
    days,
    hours,
  };
}

function renderView() {
  const showIntro = state.view !== "error";
  const showDashboard = state.view === "loading" || state.view === "ready";
  dom.intro.hidden = !showIntro;
  dom.empty.hidden = state.view !== "empty";
  dom.error.hidden = state.view !== "error";
  dom.dashboard.hidden = !showDashboard;
  dom.dashboard.setAttribute("aria-busy", String(state.view === "loading"));

  if (state.view === "loading") renderLoading();
  if (state.view === "ready") renderWeather();
}

function renderLoading() {
  renderLoadingHero();
  renderLoadingMetrics();
  renderLoadingDaily();
  renderLoadingHourly();
}

function renderLoadingHero() {
  clear(dom.hero);
  dom.hero.className = "hero hero--loading";
  const loader = append(dom.hero, "div", "loader");
  const dots = append(loader, "div", "dots");
  dots.append(
    document.createElement("span"),
    document.createElement("span"),
    document.createElement("span"),
  );
  append(loader, "p", "loader__text", "Loading...");
}

function renderLoadingMetrics() {
  clear(dom.metrics);
  ["Feels Like", "Humidity", "Wind", "Precipitation"].forEach((label) => {
    const card = append(dom.metrics, "article", "metric");
    append(card, "p", "metric__label", label);
    append(card, "p", "metric__value", "–");
  });
}

function renderLoadingDaily() {
  clear(dom.daily);
  append(dom.daily, "h2", "section-title", "Daily forecast");
  const grid = append(dom.daily, "div", "daily__grid");
  for (let index = 0; index < SKELETON_DAYS; index += 1) {
    append(grid, "div", "skeleton-card");
  }
}

function renderLoadingHourly() {
  clear(dom.hourly);
  const header = append(dom.hourly, "div", "hourly__header");
  append(header, "h2", "section-title", "Hourly forecast");
  const button = append(header, "button", "day-picker__toggle");
  button.type = "button";
  button.disabled = true;
  append(button, "span", "", "–");
  button.append(createIcon("icon-dropdown.svg", "", "chevron"));
  const list = append(dom.hourly, "div", "hourly__list");
  for (let index = 0; index < SKELETON_HOURS; index += 1) {
    append(list, "div", "skeleton-row");
  }
}

function renderWeather() {
  renderHero();
  renderMetrics();
  renderDaily();
  renderHourly();
}

function renderHero() {
  const current = state.weather.current;
  const weather = describeWeather(current.code);
  clear(dom.hero);
  dom.hero.className = "hero";

  const location = append(dom.hero, "div", "hero__location");
  append(location, "h2", "hero__place", placeLabel(state.place));
  append(location, "p", "hero__date", formatFullDate(current.time));

  const reading = append(dom.hero, "div", "hero__reading");
  reading.append(createIcon(weather.icon, weather.label, "hero__icon"));
  append(reading, "p", "hero__temp", formatTemp(current.temperature));
}

function renderMetrics() {
  const current = state.weather.current;
  const items = [
    ["Feels Like", formatTemp(current.feelsLike)],
    ["Humidity", `${Math.round(current.humidity)}%`],
    ["Wind", formatWind(current.wind)],
    ["Precipitation", formatPrecipitation(current.precipitation)],
  ];

  clear(dom.metrics);
  items.forEach(([label, value]) => {
    const card = append(dom.metrics, "article", "metric");
    append(card, "p", "metric__label", label);
    append(card, "p", "metric__value", value);
  });
}

function renderDaily() {
  clear(dom.daily);
  append(dom.daily, "h2", "section-title", "Daily forecast");
  const grid = append(dom.daily, "div", "daily__grid");

  state.weather.days.forEach((day) => {
    const weather = describeWeather(day.code);
    const card = append(grid, "article", "day");
    append(card, "p", "day__name", formatWeekday(day.date, "short"));
    card.append(createIcon(weather.icon, weather.label, "day__icon"));
    const temps = append(card, "p", "day__temps");
    append(temps, "span", "day__high", formatTemp(day.max));
    append(temps, "span", "day__low", formatTemp(day.min));
  });
}

function renderHourly() {
  const days = state.weather.days;
  const selected = days[state.selectedDay];
  clear(dom.hourly);

  const header = append(dom.hourly, "div", "hourly__header");
  append(header, "h2", "section-title", "Hourly forecast");
  const picker = append(header, "div", "day-picker");
  const toggle = append(picker, "button", "day-picker__toggle");
  toggle.type = "button";
  toggle.dataset.dayToggle = "true";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-haspopup", "listbox");
  append(toggle, "span", "", formatWeekday(selected.date, "long"));
  toggle.append(createIcon("icon-dropdown.svg", "", "chevron"));

  const menu = append(picker, "div", "menu day-menu");
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  days.forEach((day, index) => {
    const option = append(
      menu,
      "button",
      "day-menu__option",
      formatWeekday(day.date, "long"),
    );
    option.type = "button";
    option.dataset.dayIndex = String(index);
    option.setAttribute("role", "option");
    if (index === state.selectedDay) option.classList.add("is-selected");
    option.setAttribute("aria-selected", String(index === state.selectedDay));
  });

  const list = append(dom.hourly, "div", "hourly__list");
  hoursForDay(selected.date).forEach((hour) => {
    const weather = describeWeather(hour.code);
    const row = append(list, "article", "hour");
    row.dataset.hour = String(hour.hour);
    row.append(createIcon(weather.icon, weather.label, "hour__icon"));
    append(row, "p", "hour__time", formatHour(hour.hour));
    append(row, "p", "hour__temp", formatTemp(hour.temp));
  });

  scrollHourlyList(list);
}

function hoursForDay(date) {
  return state.weather.hours.filter((hour) => hour.date === date);
}

function scrollHourlyList(list) {
  if (state.selectedDay !== 0) {
    list.scrollTop = 0;
    return;
  }

  const currentHour = Number(state.weather.current.time.slice(11, 13));
  const row = list.querySelector(`[data-hour="${currentHour}"]`);
  if (!row) return;

  const alignToCurrentHour = () => {
    const delta =
      row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += delta;
  };

  alignToCurrentHour();
  requestAnimationFrame(alignToCurrentHour);
}

function renderSuggestions(places) {
  state.suggestionQuery = dom.searchInput.value.trim();
  clear(dom.searchPanel);
  if (!places.length) {
    append(dom.searchPanel, "p", "search-status", "No search result found!");
    openSearch();
    return;
  }

  const list = append(dom.searchPanel, "ul", "suggestions");
  list.id = "search-list";
  list.setAttribute("role", "listbox");
  places.forEach((place, index) => {
    const item = append(list, "li");
    const button = append(
      item,
      "button",
      "suggestion",
      suggestionLabel(place, places),
    );
    button.type = "button";
    button.id = `suggestion-${index}`;
    button.dataset.index = String(index);
    button.setAttribute("role", "option");
    button.addEventListener("click", () => selectPlace(place));
  });
  openSearch();
}

function showSearchProgress() {
  clear(dom.searchPanel);
  const row = append(dom.searchPanel, "div", "search-status");
  row.append(createIcon("icon-loading.svg", "", "search-status__icon"));
  append(row, "p", "", "Search in progress");
  openSearch();
}

function openSearch() {
  dom.searchPanel.hidden = false;
  dom.searchInput.setAttribute("aria-expanded", "true");
}

function closeSearch() {
  dom.searchPanel.hidden = true;
  dom.searchInput.setAttribute("aria-expanded", "false");
  dom.searchInput.removeAttribute("aria-activedescendant");
  state.suggestions = [];
  state.suggestionQuery = "";
  state.activeSuggestion = -1;
}

function isSearchOpen() {
  return !dom.searchPanel.hidden;
}

function moveSuggestion(step) {
  const count = state.suggestions.length;
  if (!count) return;
  const next = state.activeSuggestion + step;
  state.activeSuggestion = (next + count) % count;
  const buttons = dom.searchPanel.querySelectorAll(".suggestion");
  buttons.forEach((button, index) => {
    const active = index === state.activeSuggestion;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    if (active)
      dom.searchInput.setAttribute("aria-activedescendant", button.id);
  });
}

function closeDayMenu() {
  const toggle = dom.hourly.querySelector("[data-day-toggle]");
  const menu = dom.hourly.querySelector(".day-menu");
  if (!toggle || !menu) return;
  toggle.setAttribute("aria-expanded", "false");
  menu.hidden = true;
}

function updateUnitsMenu() {
  dom.unitsSwitch.textContent = isFullyImperial()
    ? "Switch to Metric"
    : "Switch to Imperial";
  dom.unitsMenu.querySelectorAll("[data-unit]").forEach((button) => {
    const selected = state.units[button.dataset.unit] === button.dataset.value;
    button.setAttribute("aria-checked", String(selected));
    button.querySelector(".units__check").hidden = !selected;
  });
}

function isFullyImperial() {
  return (
    state.units.temperature === IMPERIAL_UNITS.temperature &&
    state.units.wind === IMPERIAL_UNITS.wind &&
    state.units.precipitation === IMPERIAL_UNITS.precipitation
  );
}

function formatTemp(celsius) {
  const value =
    state.units.temperature === "fahrenheit" ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(value)}°`;
}

function formatWind(kmh) {
  const imperial = state.units.wind === "mph";
  const value = imperial ? kmh * KM_TO_MPH : kmh;
  return `${Math.round(value)} ${imperial ? "mph" : "km/h"}`;
}

function formatPrecipitation(mm) {
  const imperial = state.units.precipitation === "inch";
  const value = imperial ? mm * MM_TO_INCH : mm;
  const digits = imperial ? 2 : 1;
  return `${formatRounded(value, digits)} ${imperial ? "in" : "mm"}`;
}

function formatRounded(value, digits) {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(digits).replace(/\.?0+$/, "");
}

function formatFullDate(isoDate) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcNoon(isoDate));
}

function formatWeekday(isoDate, style) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: style,
    timeZone: "UTC",
  }).format(utcNoon(isoDate));
}

function utcNoon(isoDate) {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatHour(hour) {
  const period = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour} ${period}`;
}

function placeLabel(place) {
  return [place.name, place.country].filter(Boolean).join(", ");
}

function suggestionLabel(place, places) {
  const duplicates = places.filter(
    (item) => item.name === place.name && item.country === place.country,
  );
  if (duplicates.length > 1 && place.admin1) {
    return [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  }
  return placeLabel(place);
}

function describeWeather(code) {
  const match = WEATHER_TYPES.find((type) => type.test(code));
  return match || { label: "Cloudy", icon: "icon-overcast.webp" };
}

function createIcon(file, alt, className) {
  const image = document.createElement("img");
  image.src = `${ICON_PATH}${file}`;
  image.alt = alt;
  if (className) image.className = className;
  return image;
}

function append(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent.append(node);
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function setStatus(message) {
  dom.status.textContent = message;
}

function loadUnits() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return { ...METRIC_UNITS };
    return {
      temperature:
        saved.temperature === "fahrenheit" ? "fahrenheit" : "celsius",
      wind: saved.wind === "mph" ? "mph" : "kmh",
      precipitation: saved.precipitation === "inch" ? "inch" : "mm",
    };
  } catch {
    return { ...METRIC_UNITS };
  }
}

function persistUnits() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.units));
  } catch {
    // Storage can be blocked; the current view still updates.
  }
}
