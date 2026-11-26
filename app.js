(() => {
  "use strict";

  const CLIENT_ID = "1020088389545-30u5n8i5pc57k5ol61lrpi91q2ijdfv4.apps.googleusercontent.com";
  const DRIVE_FILE_NAME = "ngay-minh-di-planner.json";
  const DRIVE_SCOPE = "openid email profile https://www.googleapis.com/auth/drive.appdata";
  const STORAGE_KEY = "ngay-minh-di-planner-v1";
  const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
  const weekdayNames = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
  const today = new Date();
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const parseDateKey = (key) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const uid = () => window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const initialState = () => ({
    tripTitle: "Một chuyến đi thật xa",
    destination: "Chưa chọn điểm đến",
    dayNotes: {},
    dayDetails: {},
    days: {}
  });

  let state = loadLocalState();
  let selectedDate = dateKey(today);
  let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let calendarView = "month";
  let tokenClient = null;
  let accessToken = null;
  let googleProfile = null;
  let driveFileId = null;
  const photoUrls = new Map();
  let editingItem = null;
  let toastTimer = 0;
  let saveTimer = 0;

  const $ = (id) => document.getElementById(id);
  const els = {
    calendarDays: $("calendarDays"), yearCalendar: $("yearCalendar"), weekdays: $("weekdays"), monthLabel: $("monthLabel"), selectedDateLabel: $("selectedDateLabel"),
    dayCount: $("dayCount"), dayItemList: $("dayItemList"), dayItemsEmpty: $("dayItemsEmpty"),
    destinationInput: $("destinationInput"), tripTitle: $("tripTitle"),
    syncState: $("syncState"), syncText: $("syncText"), googleButton: $("googleButton"),
    googleButtonText: $("googleButtonText"), googleProfile: $("googleProfile"),
    googleProfileImage: $("googleProfileImage"), googleProfileInitials: $("googleProfileInitials"),
    googleProfileEmail: $("googleProfileEmail"), itemModalBackdrop: $("itemModalBackdrop"),
    dayItemForm: $("dayItemForm"), dayItemType: $("dayItemType"), noteInput: $("noteInput"),
    todayDateLabel: $("todayDateLabel"), menuToggle: $("menuToggle"), menuPopover: $("menuPopover")
  };

  function loadLocalState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return initialState();
      const parsed = JSON.parse(saved);
      return {
        ...initialState(),
        ...parsed,
        days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
        dayNotes: parsed.dayNotes && typeof parsed.dayNotes === "object" ? parsed.dayNotes : {},
        dayDetails: parsed.dayDetails && typeof parsed.dayDetails === "object" ? parsed.dayDetails : {}
      };
    } catch (error) {
      console.error("Could not read the saved trip plan.", error);
      return initialState();
    }
  }

  function setSyncStatus(status, message) {
    els.syncState.classList.remove("saving", "error");
    if (status === "saving") els.syncState.classList.add("saving");
    if (status === "error") els.syncState.classList.add("error");
    els.syncText.textContent = message;
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function persistState() {
    let localSaveError = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save the trip plan locally.", error);
      localSaveError = error;
    }
    if (accessToken) {
      setSyncStatus("saving", "Đang đồng bộ Google Drive");
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => saveToDrive().catch(handleDriveError), 350);
      if (localSaveError) showToast("Bộ nhớ trình duyệt đã đầy; dữ liệu sẽ được lưu vào Google Drive.");
    } else if (localSaveError) {
      setSyncStatus("error", "Không đủ bộ nhớ trên thiết bị");
      showToast("Bộ nhớ trình duyệt đã đầy. Hãy kết nối Google Drive để lưu thêm ảnh.");
    } else {
      setSyncStatus("", "Đang lưu trên thiết bị");
    }
  }

  function handleDriveError(error) {
    console.error("Google Drive sync failed.", error);
    if (error && error.status === 401) {
      accessToken = null;
      googleProfile = null;
      els.googleButtonText.textContent = "Kết nối lại Google";
      updateGoogleButton();
      setSyncStatus("error", "Phiên Google đã hết hạn");
      showToast("Phiên Google đã hết hạn. Hãy kết nối lại để tiếp tục đồng bộ.");
      return;
    }
    setSyncStatus("error", "Đồng bộ chưa thành công");
    showToast("Không thể đồng bộ với Google Drive. Dữ liệu vẫn được lưu trên thiết bị.");
  }

  function formatSelectedDate(key) {
    const date = parseDateKey(key);
    return `${weekdayNames[date.getDay()]}, ${date.getDate()} tháng ${date.getMonth() + 1}`;
  }

  function renderCalendar() {
    if (calendarView === "year") {
      renderYearCalendar();
      return;
    }
    renderMonthCalendar();
  }

  function hasDayContent(key) {
    const details = state.dayDetails[key] || {};
    return (state.days[key] || []).length > 0
      || Boolean(state.dayNotes[key])
      || Boolean(details.plan)
      || (details.itinerary || []).length > 0
      || (details.expenses || []).length > 0
      || (details.photos || []).length > 0;
  }

  function renderMonthCalendar() {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    els.monthLabel.textContent = `${monthNames[month]}, ${year}`;
    els.calendarDays.hidden = false;
    els.yearCalendar.hidden = true;
    els.weekdays.hidden = false;
    $("monthViewButton").classList.add("active");
    $("yearViewButton").classList.remove("active");
    $("monthViewButton").setAttribute("aria-pressed", "true");
    $("yearViewButton").setAttribute("aria-pressed", "false");
    els.calendarDays.replaceChildren();

    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousMonthDays = new Date(year, month, 0).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

    for (let index = 0; index < cellCount; index += 1) {
      let date;
      let inMonth = true;
      if (index < firstWeekday) {
        date = new Date(year, month - 1, previousMonthDays - firstWeekday + index + 1);
        inMonth = false;
      } else if (index >= firstWeekday + daysInMonth) {
        date = new Date(year, month + 1, index - firstWeekday - daysInMonth + 1);
        inMonth = false;
      } else {
        date = new Date(year, month, index - firstWeekday + 1);
      }

      const key = dateKey(date);
      const cell = document.createElement("div");
      cell.className = "calendar-day";
      if (!inMonth) cell.classList.add("muted");
      if (key === dateKey(today)) cell.classList.add("today");
      if (key === selectedDate) cell.classList.add("selected");
      if (hasDayContent(key)) cell.classList.add("has-notes");
      cell.setAttribute("role", "gridcell");

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(date.getDate());
      button.setAttribute("aria-label", `${weekdayNames[date.getDay()]}, ${date.getDate()} tháng ${date.getMonth() + 1}`);
      if (key === selectedDate) button.setAttribute("aria-pressed", "true");
      button.addEventListener("click", () => {
        selectedDate = key;
        if (!inMonth) visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        renderCalendar();
        renderDay();
      });
      cell.append(button);
      els.calendarDays.append(cell);
    }
  }

  function renderYearCalendar() {
    const year = visibleMonth.getFullYear();
    els.monthLabel.textContent = String(year);
    els.calendarDays.hidden = true;
    els.yearCalendar.hidden = false;
    els.weekdays.hidden = true;
    $("monthViewButton").classList.remove("active");
    $("yearViewButton").classList.add("active");
    $("monthViewButton").setAttribute("aria-pressed", "false");
    $("yearViewButton").setAttribute("aria-pressed", "true");
    els.yearCalendar.replaceChildren();

    monthNames.forEach((name, month) => {
      const monthCard = document.createElement("section");
      monthCard.className = "mini-month";
      const monthButton = document.createElement("button");
      monthButton.className = "mini-month-title";
      monthButton.type = "button";
      monthButton.textContent = name;
      monthButton.addEventListener("click", () => {
        visibleMonth = new Date(year, month, 1);
        calendarView = "month";
        renderCalendar();
      });
      const grid = document.createElement("div");
      grid.className = "mini-month-days";
      grid.setAttribute("role", "grid");
      const offset = (new Date(year, month, 1).getDay() + 6) % 7;
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      ["T2", "T3", "T4", "T5", "T6", "T7", "CN"].forEach((label) => {
        const weekday = document.createElement("span");
        weekday.className = "mini-weekday";
        weekday.textContent = label;
        grid.append(weekday);
      });
      for (let blank = 0; blank < offset; blank += 1) {
        const spacer = document.createElement("span");
        spacer.className = "mini-day spacer";
        grid.append(spacer);
      }
      for (let day = 1; day <= daysInMonth; day += 1) {
        const key = dateKey(new Date(year, month, day));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mini-day";
        button.textContent = String(day);
        button.setAttribute("aria-label", `${day} tháng ${month + 1}, ${year}`);
        if (key === dateKey(today)) button.classList.add("today");
        if (key === selectedDate) button.classList.add("selected");
        if (hasDayContent(key)) button.classList.add("has-notes");
        button.addEventListener("click", () => {
          selectedDate = key;
          renderCalendar();
          renderDay();
        });
        grid.append(button);
      }
      monthCard.append(monthButton, grid);
      els.yearCalendar.append(monthCard);
    });
  }

  function makeNodeAction(label, ariaLabel, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "node-action";
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.title = ariaLabel;
    button.addEventListener("click", callback);
    return button;
  }

  function removeNode(nodes, id) {
    const index = nodes.findIndex((node) => node.id === id);
    if (index !== -1) {
      nodes.splice(index, 1);
      return true;
    }
    return nodes.some((node) => removeNode(Array.isArray(node.children) ? node.children : [], id));
  }

  function renderDay() {
    els.selectedDateLabel.textContent = formatSelectedDate(selectedDate);
    const details = state.dayDetails[selectedDate] || {};
    renderDayItems(details);
  }

  function getDayDetails() {
    if (!state.dayDetails[selectedDate]) state.dayDetails[selectedDate] = { plan: "", itinerary: [], expenses: [], photos: [] };
    const details = state.dayDetails[selectedDate];
    if (!Array.isArray(details.itinerary)) details.itinerary = [];
    if (!Array.isArray(details.expenses)) details.expenses = [];
    if (!Array.isArray(details.photos)) details.photos = [];
    return details;
  }

  function formatCurrency(amount) {
    return `${new Intl.NumberFormat("vi-VN").format(Number(amount) || 0)} ₫`;
  }

  function collectDayItems(details) {
    const items = [];
    if (details.plan) items.push({ type: "plan", id: "plan", text: details.plan });
    if (state.dayNotes[selectedDate]) items.push({ type: "dayNote", id: "dayNote", text: state.dayNotes[selectedDate] });

    const collectNotes = (nodes, depth = 0, parentText = "") => {
      nodes.forEach((node) => {
        items.push({ type: "note", id: node.id, text: node.text, done: node.done, depth, parentText, data: node });
        collectNotes(Array.isArray(node.children) ? node.children : [], depth + 1, node.text);
      });
    };
    collectNotes(state.days[selectedDate] || []);
    (details.itinerary || []).slice().sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"))
      .forEach((entry) => items.push({ type: "itinerary", id: entry.id, text: entry.text, done: entry.done, time: entry.time, data: entry }));
    (details.expenses || []).forEach((entry) => items.push({ type: "expense", id: entry.id, text: entry.text, category: entry.category, amount: entry.amount, data: entry }));
    (details.photos || []).forEach((entry) => items.push({ type: "photo", id: entry.id, text: entry.name || "Khoảnh khắc", data: entry }));
    return items;
  }

  function deleteDayItem(item) {
    if (item.type === "photo") {
      deletePhoto(item.data);
      return;
    }
    if (item.type === "note" && !window.confirm(`Xóa “${item.text}” và các nhánh bên dưới?`)) return;
    if (item.type === "plan") {
      getDayDetails().plan = "";
    } else if (item.type === "dayNote") {
      delete state.dayNotes[selectedDate];
    } else if (item.type === "note") {
      removeNode(state.days[selectedDate] || [], item.id);
    } else if (item.type === "itinerary") {
      const details = getDayDetails();
      details.itinerary = details.itinerary.filter((entry) => entry.id !== item.id);
    } else if (item.type === "expense") {
      const details = getDayDetails();
      details.expenses = details.expenses.filter((entry) => entry.id !== item.id);
    }
    persistState();
    renderCalendar();
    renderDay();
  }

  function renderDayItems(details) {
    const items = collectDayItems(details);
    els.dayCount.textContent = `${items.length} mục`;
    els.dayItemList.replaceChildren();
    els.dayItemsEmpty.hidden = items.length > 0;
    const labels = { plan: "Ý tưởng", dayNote: "Lời nhắn", note: "Ghi chú", itinerary: "Lịch trình", expense: "Chi tiêu", photo: "Ảnh" };

    items.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "day-item";
      card.dataset.itemType = entry.type;
      if (entry.depth) card.style.setProperty("--item-depth", String(Math.min(entry.depth, 3)));
      if (entry.done) card.classList.add("is-done");

      const main = document.createElement("div");
      main.className = "day-item-main";
      if (entry.type === "photo") {
        const image = document.createElement("img");
        image.className = "day-item-photo";
        image.alt = entry.text;
        image.loading = "lazy";
        if (entry.data.dataUrl) image.src = entry.data.dataUrl;
        else if (entry.data.driveFileId && accessToken) loadDrivePhoto(entry.data, image);
        main.append(image);
      }

      const copy = document.createElement("div");
      copy.className = "day-item-copy";
      const heading = document.createElement("div");
      heading.className = "day-item-heading";
      const kind = document.createElement("span");
      kind.className = "day-item-kind";
      kind.textContent = labels[entry.type];
      heading.append(kind);
      const meta = document.createElement("span");
      meta.className = "day-item-meta";
      if (entry.type === "itinerary") meta.textContent = entry.time || "Cả ngày";
      else if (entry.type === "expense") meta.textContent = `${entry.category || "Khác"} · ${formatCurrency(entry.amount)}`;
      else if (entry.parentText) meta.textContent = `Nhánh của ${entry.parentText}`;
      if (meta.textContent) heading.append(meta);
      const text = document.createElement("p");
      text.className = "day-item-text";
      text.textContent = entry.text;
      copy.append(heading, text);
      main.append(copy);

      const actions = document.createElement("div");
      actions.className = "day-item-actions";
      if (entry.type === "note" || entry.type === "itinerary") {
        const done = makeNodeAction(entry.done ? "✓" : "○", entry.done ? "Đánh dấu chưa xong" : "Đánh dấu hoàn tất", () => {
          entry.data.done = !entry.data.done;
          persistState();
          renderDay();
        });
        actions.append(done);
      }
      if (entry.type !== "photo") {
        const edit = makeNodeAction("✎", `Sửa ${labels[entry.type].toLowerCase()}`, () => openDayItemModal(entry.type, entry));
        actions.append(edit);
      }
      const remove = makeNodeAction("×", `Xóa ${labels[entry.type].toLowerCase()}`, () => deleteDayItem(entry));
      remove.classList.add("delete");
      actions.append(remove);
      card.append(main, actions);
      els.dayItemList.append(card);
    });
  }

  async function loadDrivePhoto(photo, image) {
    const key = photo.driveFileId;
    try {
      let urlPromise = photoUrls.get(key);
      if (!urlPromise) {
        urlPromise = fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(key)}?alt=media`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        }).then(async (response) => {
          if (!response.ok) {
            const error = new Error(`Google Drive photo request failed (${response.status}).`);
            error.status = response.status;
            throw error;
          }
          return URL.createObjectURL(await response.blob());
        });
        photoUrls.set(key, urlPromise);
      }
      const url = await urlPromise;
      if (image.isConnected) image.src = url;
    } catch (error) {
      photoUrls.delete(key);
      console.error("Could not load a trip photo from Google Drive.", error);
      if (error.status === 401) handleDriveError(error);
      else if (image.isConnected) image.alt = "Không tải được ảnh. Hãy thử kết nối Google Drive.";
    }
  }

  async function deletePhoto(photo) {
    if (photo.driveFileId && accessToken) {
      try {
        await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(photo.driveFileId)}`, { method: "DELETE" });
        const urlPromise = photoUrls.get(photo.driveFileId);
        if (urlPromise) URL.revokeObjectURL(await urlPromise);
        photoUrls.delete(photo.driveFileId);
      } catch (error) {
        handleDriveError(error);
        return;
      }
    }
    const details = getDayDetails();
    details.photos = details.photos.filter((item) => item.id !== photo.id);
    persistState();
    renderCalendar();
    renderDay();
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Tệp đã chọn không phải ảnh."));
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        reject(new Error("Ảnh gốc vượt quá 15 MB."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Không thể đọc tệp ảnh."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Tệp ảnh không hợp lệ hoặc không thể mở."));
        image.onload = () => {
          const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Trình duyệt không thể xử lý ảnh này."));
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/webp", 0.78));
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function findNode(nodes, id) {
    for (const node of nodes) {
      if (node.id === id) return node;
      const match = findNode(Array.isArray(node.children) ? node.children : [], id);
      if (match) return match;
    }
    return null;
  }

  function populateNoteParents() {
    const select = $("noteParent");
    select.replaceChildren(new Option("Ghi chú mới", ""));
    const appendOptions = (nodes, depth = 0) => {
      nodes.forEach((node) => {
        const option = new Option(`${"— ".repeat(depth)}${node.text}`, node.id);
        select.append(option);
        appendOptions(Array.isArray(node.children) ? node.children : [], depth + 1);
      });
    };
    appendOptions(state.days[selectedDate] || []);
  }

  function updateItemModalFields() {
    const type = els.dayItemType.value;
    document.querySelectorAll("[data-item-fields]").forEach((section) => {
      section.hidden = section.dataset.itemFields !== type;
    });
    $("itemModalTitle").textContent = editingItem ? "Sửa mục trong ngày" : "Thêm vào ngày";
    $("itemModalSubmit").innerHTML = editingItem ? "Lưu thay đổi <span>↗</span>" : "Thêm mục <span>↗</span>";
    $("noteParent").disabled = Boolean(editingItem);
  }

  function updateTripDetails() {
    state.tripTitle = els.tripTitle.textContent.trim() || "Một chuyến đi thật xa";
    els.tripTitle.textContent = state.tripTitle;
    state.destination = els.destinationInput.value.trim() || "Chưa chọn điểm đến";
    els.destinationInput.value = state.destination;
    persistState();
  }

  function updateGoogleButton() {
    const connected = Boolean(accessToken && googleProfile);
    els.googleButton.hidden = connected;
    els.googleProfile.hidden = !connected;
    if (!connected) {
      els.googleProfileImage.hidden = true;
      els.googleProfileInitials.hidden = true;
      els.googleProfileImage.removeAttribute("src");
      return;
    }
    els.googleProfileEmail.textContent = googleProfile.email;
    const initials = googleProfile.name
      ? googleProfile.name.trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase()
      : googleProfile.email[0].toUpperCase();
    els.googleProfileInitials.textContent = initials;
    els.googleProfileImage.onerror = () => {
      els.googleProfileImage.hidden = true;
      els.googleProfileInitials.hidden = false;
    };
    els.googleProfileInitials.hidden = Boolean(googleProfile.picture);
    els.googleProfileImage.hidden = !googleProfile.picture;
    if (googleProfile.picture) els.googleProfileImage.src = googleProfile.picture;
  }

  async function loadGoogleProfile(token) {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const error = new Error(`Google profile request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    const profile = await response.json();
    if (!profile.email) throw new Error("Google profile response did not include an email address.");
    return { email: profile.email, name: profile.name || "", picture: profile.picture || "" };
  }

  function openDayItemModal(type = "note", item = null) {
    editingItem = item ? { type: item.type, id: item.id } : null;
    els.dayItemForm.reset();
    populateNoteParents();
    const details = state.dayDetails[selectedDate] || {};
    const options = Array.from(els.dayItemType.options);
    options.forEach((option) => {
      option.disabled = !editingItem && (
        (option.value === "plan" && Boolean(details.plan))
        || (option.value === "dayNote" && Boolean(state.dayNotes[selectedDate]))
      );
    });
    els.dayItemType.disabled = Boolean(editingItem);
    els.dayItemType.value = type;
    if (els.dayItemType.selectedOptions[0].disabled) {
      els.dayItemType.value = options.find((option) => !option.disabled).value;
    }

    if (item) {
      if (item.type === "note") {
        els.noteInput.value = item.text;
      } else if (item.type === "plan") {
        $("dayPlanInput").value = item.text;
      } else if (item.type === "dayNote") {
        $("dayNoteInput").value = item.text;
      } else if (item.type === "itinerary") {
        $("itineraryTime").value = item.time || "";
        $("itineraryText").value = item.text;
      } else if (item.type === "expense") {
        $("expenseText").value = item.text;
        $("expenseCategory").value = item.category || "";
        $("expenseAmount").value = item.amount;
      }
    }
    updateItemModalFields();
    $("itemModalKicker").textContent = editingItem ? "CHỈNH SỬA NỘI DUNG" : "MỘT MỤC MỚI";
    els.itemModalBackdrop.hidden = false;
    const focusTarget = els.dayItemForm.querySelector(`[data-item-fields="${els.dayItemType.value}"] textarea, [data-item-fields="${els.dayItemType.value}"] input`);
    window.setTimeout(() => focusTarget?.focus(), 0);
  }

  function closeDayItemModal() {
    els.itemModalBackdrop.hidden = true;
    editingItem = null;
    els.dayItemType.disabled = false;
    els.dayItemForm.reset();
  }

  async function saveDayItem(event) {
    event.preventDefault();
    const type = els.dayItemType.value;
    const existing = editingItem;
    const valueFor = (id) => $(id).value.trim();

    if (type === "photo") {
      const files = Array.from($("photoInput").files || []);
      if (!files.length) {
        showToast("Hãy chọn ít nhất một ảnh để thêm.");
        return;
      }
      const details = getDayDetails();
      const failures = [];
      let added = 0;
      for (const file of files) {
        try {
          const dataUrl = await compressImage(file);
          details.photos.push({
            id: uid(),
            name: file.name,
            mimeType: dataUrl.slice(5, dataUrl.indexOf(";")),
            dataUrl
          });
          added += 1;
        } catch (error) {
          console.error(`Could not add photo "${file.name}".`, error);
          failures.push(file.name);
        }
      }
      if (!added) {
        showToast(`Không thể thêm ảnh. Tệp cần là ảnh hợp lệ và nhỏ hơn 15 MB.`);
        return;
      }
      if (failures.length) showToast(`Đã thêm ${added} ảnh; không thể thêm ${failures.length} ảnh còn lại.`);
    } else if (type === "note") {
      const text = valueFor("noteInput");
      if (!text) {
        showToast("Hãy nhập nội dung ghi chú.");
        return;
      }
      const roots = state.days[selectedDate] || (state.days[selectedDate] = []);
      if (existing) {
        const node = findNode(roots, existing.id);
        if (!node) {
          showToast("Không tìm thấy ghi chú cần sửa.");
          return;
        }
        node.text = text;
      } else {
        const parentId = $("noteParent").value;
        const node = { id: uid(), text, done: false, children: [] };
        if (parentId) {
          const parent = findNode(roots, parentId);
          if (!parent) {
            showToast("Không tìm thấy nhánh cần thêm ghi chú.");
            return;
          }
          if (!Array.isArray(parent.children)) parent.children = [];
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
    } else if (type === "plan" || type === "dayNote") {
      const text = valueFor(type === "plan" ? "dayPlanInput" : "dayNoteInput");
      if (!text) {
        showToast("Hãy nhập nội dung trước khi lưu.");
        return;
      }
      const currentDetails = state.dayDetails[selectedDate] || {};
      if (!existing && ((type === "plan" && currentDetails.plan) || (type === "dayNote" && state.dayNotes[selectedDate]))) {
        showToast("Ngày này đã có mục cùng loại. Hãy sửa mục hiện có.");
        return;
      }
      if (type === "plan") getDayDetails().plan = text;
      else state.dayNotes[selectedDate] = text;
    } else if (type === "itinerary") {
      const text = valueFor("itineraryText");
      if (!text) {
        showToast("Hãy nhập nội dung lịch trình.");
        return;
      }
      const details = getDayDetails();
      const entry = existing
        ? details.itinerary.find((item) => item.id === existing.id)
        : { id: uid(), done: false };
      if (!entry) {
        showToast("Không tìm thấy lịch trình cần sửa.");
        return;
      }
      entry.time = $("itineraryTime").value;
      entry.text = text;
      if (!existing) details.itinerary.push(entry);
    } else if (type === "expense") {
      const text = valueFor("expenseText");
      const rawAmount = $("expenseAmount").value;
      const amount = Number(rawAmount);
      if (!text || rawAmount === "" || !Number.isFinite(amount) || amount < 0) {
        showToast("Nhập tên khoản chi và số tiền hợp lệ.");
        return;
      }
      const details = getDayDetails();
      const entry = existing
        ? details.expenses.find((item) => item.id === existing.id)
        : { id: uid() };
      if (!entry) {
        showToast("Không tìm thấy khoản chi cần sửa.");
        return;
      }
      entry.text = text;
      entry.category = valueFor("expenseCategory");
      entry.amount = amount;
      if (!existing) details.expenses.push(entry);
    }

    $("photoInput").value = "";
    closeDayItemModal();
    persistState();
    renderCalendar();
    renderDay();
  }

  function initGoogleAuth() {
    if (CLIENT_ID === "YOUR_GOOGLE_OAUTH_CLIENT_ID") {
      els.googleButtonText.textContent = "Kết nối Google";
      els.googleButton.title = "Thêm OAuth Client ID trong app.js để bật Google Drive";
      return;
    }
    const waitForGoogle = window.setInterval(() => {
      if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) return;
      window.clearInterval(waitForGoogle);
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: DRIVE_SCOPE,
        include_granted_scopes: true,
        callback: async (response) => {
          if (response.error) {
            console.error("Google authorization failed.", response);
            setSyncStatus("error", "Đăng nhập Google chưa thành công");
            showToast("Không thể kết nối Google. Vui lòng thử lại.");
            return;
          }
          accessToken = response.access_token;
          try {
            googleProfile = await loadGoogleProfile(accessToken);
            updateGoogleButton();
          } catch (error) {
            console.error("Could not load Google profile.", error);
            accessToken = null;
            googleProfile = null;
            updateGoogleButton();
            setSyncStatus("error", "Không tải được hồ sơ Google");
            showToast("Không thể tải Gmail và ảnh đại diện. Hãy kết nối lại Google.");
            return;
          }
          try {
            await loadFromDrive();
            setSyncStatus("", "Đã đồng bộ Google Drive");
            showToast("Đã kết nối và đồng bộ với Google Drive.");
          } catch (error) {
            handleDriveError(error);
          }
        }
      });
      els.googleButton.title = "";
    }, 100);
    window.setTimeout(() => {
      window.clearInterval(waitForGoogle);
      if (!window.google && CLIENT_ID !== "YOUR_GOOGLE_OAUTH_CLIENT_ID") {
        setSyncStatus("error", "Không tải được Google Sign-In");
        showToast("Không tải được dịch vụ Google. Hãy kiểm tra kết nối mạng.");
      }
    }, 15000);
  }

  function driveRequest(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
    }).then(async (response) => {
      if (!response.ok) {
        const error = new Error(`Google Drive request failed (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return null;
      return response.json();
    });
  }

  async function findDriveFile() {
    const query = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and 'appDataFolder' in parents and trashed=false`);
    const result = await driveRequest(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=${query}`);
    return result.files && result.files.length ? result.files[0].id : null;
  }

  async function loadFromDrive() {
    driveFileId = await findDriveFile();
    if (!driveFileId) {
      await saveToDrive();
      return;
    }
    const data = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Google Drive returned invalid planner data.");
    state = {
      ...initialState(),
      ...data,
      days: data.days && typeof data.days === "object" ? data.days : {},
      dayNotes: data.dayNotes && typeof data.dayNotes === "object" ? data.dayNotes : {},
      dayDetails: data.dayDetails && typeof data.dayDetails === "object" ? data.dayDetails : {}
    };
    saveLocalCopy();
    renderAll();
  }

  async function saveToDrive() {
    await uploadLocalPhotos();
    const content = JSON.stringify(state, (key, value) => key === "dataUrl" ? undefined : value);
    if (!driveFileId) {
      const boundary = `planner_${uid().replace(/-/g, "")}`;
      const metadata = { name: DRIVE_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" };
      const body = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        content,
        `--${boundary}--`
      ].join("\r\n");
      const created = await driveRequest(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body
      });
      driveFileId = created.id;
    } else {
      await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(driveFileId)}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: content
      });
    }
    setSyncStatus("", "Đã đồng bộ Google Drive");
  }

  async function uploadLocalPhotos() {
    for (const details of Object.values(state.dayDetails || {})) {
      for (const photo of details.photos || []) {
        if (!photo.dataUrl || photo.driveFileId) continue;
        const imageBlob = await (await fetch(photo.dataUrl)).blob();
        const boundary = `photo_${uid().replace(/-/g, "")}`;
        const metadata = {
          name: photo.name || "ngay-minh-di-photo.webp",
          parents: ["appDataFolder"],
          mimeType: photo.mimeType || imageBlob.type || "image/webp",
          appProperties: { plannerPhotoId: photo.id }
        };
        const body = new Blob([
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
          `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
          imageBlob,
          `\r\n--${boundary}--`
        ], { type: `multipart/related; boundary=${boundary}` });
        const uploaded = await driveRequest("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body
        });
        photo.driveFileId = uploaded.id;
      }
    }
    saveLocalCopy();
  }

  function saveLocalCopy() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not cache the trip plan locally.", error);
    }
  }

  function renderAll() {
    els.tripTitle.textContent = state.tripTitle;
    els.destinationInput.value = state.destination;
    renderCalendar();
    renderDay();
  }

  $("prevMonth").addEventListener("click", () => {
    visibleMonth = calendarView === "year"
      ? new Date(visibleMonth.getFullYear() - 1, visibleMonth.getMonth(), 1)
      : new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $("nextMonth").addEventListener("click", () => {
    visibleMonth = calendarView === "year"
      ? new Date(visibleMonth.getFullYear() + 1, visibleMonth.getMonth(), 1)
      : new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  $("monthViewButton").addEventListener("click", () => {
    calendarView = "month";
    renderCalendar();
  });
  $("yearViewButton").addEventListener("click", () => {
    calendarView = "year";
    renderCalendar();
  });
  const goToToday = () => {
    selectedDate = dateKey(today);
    visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    calendarView = "month";
    renderCalendar();
    renderDay();
  };
  $("todayButton").addEventListener("click", goToToday);
  $("todayMenuButton").addEventListener("click", () => {
    goToToday();
    closeMenu();
    $("selectedDateLabel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("calendarMenuButton").addEventListener("click", () => {
    closeMenu();
    document.querySelector(".calendar-card").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const closeMenu = () => {
    els.menuPopover.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    els.menuToggle.setAttribute("aria-label", "Mở menu");
  };
  els.menuToggle.addEventListener("click", () => {
    const isOpen = !els.menuPopover.hidden;
    els.menuPopover.hidden = isOpen;
    els.menuToggle.setAttribute("aria-expanded", String(!isOpen));
    els.menuToggle.setAttribute("aria-label", isOpen ? "Mở menu" : "Đóng menu");
  });
  document.addEventListener("click", (event) => {
    if (!els.menuPopover.hidden && !els.menuPopover.contains(event.target) && !els.menuToggle.contains(event.target)) closeMenu();
  });
  $("todayDateLabel").textContent = `${today.getDate()}/${today.getMonth() + 1}`;
  $("addDayItemButton").addEventListener("click", () => openDayItemModal());
  $("editTitleButton").addEventListener("click", () => {
    els.tripTitle.focus();
    const range = document.createRange();
    range.selectNodeContents(els.tripTitle);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  els.tripTitle.addEventListener("blur", updateTripDetails);
  els.tripTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.tripTitle.blur();
    }
  });
  els.destinationInput.addEventListener("change", updateTripDetails);
  els.dayItemType.addEventListener("change", updateItemModalFields);
  $("itemModalClose").addEventListener("click", closeDayItemModal);
  $("itemModalCancel").addEventListener("click", closeDayItemModal);
  els.itemModalBackdrop.addEventListener("click", (event) => {
    if (event.target === els.itemModalBackdrop) closeDayItemModal();
  });
  els.dayItemForm.addEventListener("submit", saveDayItem);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.itemModalBackdrop.hidden) closeDayItemModal();
    if (!els.menuPopover.hidden) closeMenu();
  });
  els.googleButton.addEventListener("click", () => {
    if (CLIENT_ID === "YOUR_GOOGLE_OAUTH_CLIENT_ID") {
      showToast("Thêm Google OAuth Client ID vào app.js để bật đồng bộ Drive.");
      return;
    }
    if (!tokenClient) {
      showToast("Google Sign-In đang tải. Thử lại sau giây lát.");
      return;
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });

  renderAll();
  initGoogleAuth();
})();
