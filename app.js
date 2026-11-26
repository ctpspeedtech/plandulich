(() => {
  "use strict";

  const CLIENT_ID = "1020088389545-30u5n8i5pc57k5ol61lrpi91q2ijdfv4.apps.googleusercontent.com";
  const DRIVE_FILE_NAME = "ngay-minh-di-planner.json";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
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
  let driveFileId = null;
  let planSaveTimer = 0;
  const photoUrls = new Map();
  let addParentId = null;
  let toastTimer = 0;
  let saveTimer = 0;

  const $ = (id) => document.getElementById(id);
  const els = {
    calendarDays: $("calendarDays"), yearCalendar: $("yearCalendar"), weekdays: $("weekdays"), monthLabel: $("monthLabel"), selectedDateLabel: $("selectedDateLabel"),
    dayCount: $("dayCount"), treeContainer: $("treeContainer"), emptyState: $("emptyState"),
    dayNoteText: $("dayNoteText"), destinationInput: $("destinationInput"), tripTitle: $("tripTitle"),
    syncState: $("syncState"), syncText: $("syncText"), googleButton: $("googleButton"),
    googleButtonText: $("googleButtonText"), modalBackdrop: $("modalBackdrop"), noteForm: $("noteForm"),
    noteInput: $("noteInput"), noteCountFooter: $("noteCountFooter"), todayDateLabel: $("todayDateLabel"),
    dayPlanInput: $("dayPlanInput"), itineraryList: $("itineraryList"), expenseRows: $("expenseRows"), photoGrid: $("photoGrid")
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
      els.googleButtonText.textContent = "Kết nối lại Google";
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

  function countNodes(nodes) {
    return nodes.reduce((sum, node) => sum + 1 + countNodes(Array.isArray(node.children) ? node.children : []), 0);
  }

  function renderTree(nodes, parentElement) {
    nodes.forEach((node) => {
      const item = document.createElement("div");
      item.className = "tree-node";
      if (node.done) item.classList.add("is-done");
      item.dataset.nodeId = node.id;

      const content = document.createElement("div");
      content.className = "tree-node-content";
      const marker = document.createElement("span");
      marker.className = "node-marker";
      marker.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "node-text";
      text.textContent = node.text;
      const actions = document.createElement("div");
      actions.className = "node-actions";

      const doneButton = makeNodeAction(node.done ? "✓" : "○", node.done ? "Đánh dấu chưa xong" : "Đánh dấu hoàn tất", () => {
        node.done = !node.done;
        persistState();
        renderDay();
      });
      const branchButton = makeNodeAction("+", "Thêm nhánh con", () => openNoteModal(node.id));
      const deleteButton = makeNodeAction("×", "Xóa ghi chú và các nhánh con", () => {
        if (!window.confirm(`Xóa “${node.text}” và các nhánh bên dưới?`)) return;
        const roots = state.days[selectedDate] || [];
        removeNode(roots, node.id);
        persistState();
        renderCalendar();
        renderDay();
      });
      deleteButton.classList.add("delete");
      actions.append(doneButton, branchButton, deleteButton);
      content.append(marker, text, actions);
      item.append(content);

      if (Array.isArray(node.children) && node.children.length) {
        const children = document.createElement("div");
        children.className = "tree-children";
        renderTree(node.children, children);
        item.append(children);
      }
      parentElement.append(item);
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
    const roots = state.days[selectedDate] || [];
    const count = countNodes(roots);
    els.dayCount.textContent = `${count} mục`;
    els.noteCountFooter.textContent = `${count} ý tưởng`;
    els.dayNoteText.textContent = state.dayNotes[selectedDate] || "Mỗi hành trình bắt đầu từ một ý tưởng nhỏ.";
    els.treeContainer.replaceChildren();
    els.emptyState.hidden = count > 0;
    if (count) renderTree(roots, els.treeContainer);
    const details = state.dayDetails[selectedDate] || {};
    els.dayPlanInput.value = details.plan || "";
    renderItinerary(details.itinerary || []);
    renderExpenses(details.expenses || []);
    renderPhotos(details.photos || []);
  }

  function getDayDetails() {
    if (!state.dayDetails[selectedDate]) state.dayDetails[selectedDate] = { plan: "", itinerary: [], expenses: [], photos: [] };
    const details = state.dayDetails[selectedDate];
    if (!Array.isArray(details.itinerary)) details.itinerary = [];
    if (!Array.isArray(details.expenses)) details.expenses = [];
    if (!Array.isArray(details.photos)) details.photos = [];
    return details;
  }

  function renderItinerary(entries) {
    els.itineraryList.replaceChildren();
    $("itineraryEmpty").hidden = entries.length > 0;
    entries.slice().sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99")).forEach((entry) => {
      const row = document.createElement("div");
      row.className = "itinerary-row";
      if (entry.done) row.classList.add("is-done");
      const time = document.createElement("time");
      time.className = "itinerary-time";
      time.textContent = entry.time || "Cả ngày";
      const marker = document.createElement("span");
      marker.className = "itinerary-marker";
      const text = document.createElement("span");
      text.className = "itinerary-text";
      text.textContent = entry.text;
      const done = makeNodeAction(entry.done ? "✓" : "○", entry.done ? "Đánh dấu chưa xong" : "Đánh dấu hoàn tất", () => {
        entry.done = !entry.done;
        persistState();
        renderDay();
      });
      done.classList.add("entry-check");
      const remove = makeNodeAction("×", "Xóa lịch trình", () => {
        const details = getDayDetails();
        details.itinerary = details.itinerary.filter((item) => item.id !== entry.id);
        persistState();
        renderCalendar();
        renderDay();
      });
      remove.classList.add("delete");
      row.append(time, marker, text, done, remove);
      els.itineraryList.append(row);
    });
  }

  function renderExpenses(expenses) {
    els.expenseRows.replaceChildren();
    $("expenseEmpty").hidden = expenses.length > 0;
    let total = 0;
    expenses.forEach((expense) => {
      total += Number(expense.amount) || 0;
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = expense.text;
      const category = document.createElement("td");
      category.textContent = expense.category || "Khác";
      const amount = document.createElement("td");
      amount.className = "amount-cell";
      amount.textContent = formatCurrency(expense.amount);
      const actions = document.createElement("td");
      actions.className = "expense-actions";
      const remove = makeNodeAction("×", "Xóa khoản chi", () => {
        const details = getDayDetails();
        details.expenses = details.expenses.filter((item) => item.id !== expense.id);
        persistState();
        renderCalendar();
        renderDay();
      });
      remove.classList.add("delete");
      actions.append(remove);
      row.append(name, category, amount, actions);
      els.expenseRows.append(row);
    });
    $("expenseTotal").textContent = formatCurrency(total);
  }

  function formatCurrency(amount) {
    return `${new Intl.NumberFormat("vi-VN").format(Number(amount) || 0)} ₫`;
  }

  function renderPhotos(photos) {
    els.photoGrid.replaceChildren();
    $("photosEmpty").hidden = photos.length > 0;
    photos.forEach((photo) => {
      const card = document.createElement("figure");
      card.className = "photo-card";
      const image = document.createElement("img");
      image.alt = photo.name || "Ảnh chuyến đi";
      image.loading = "lazy";
      if (photo.dataUrl) {
        image.src = photo.dataUrl;
      } else if (photo.driveFileId && accessToken) {
        loadDrivePhoto(photo, image);
      }
      const caption = document.createElement("figcaption");
      caption.textContent = photo.name || "Khoảnh khắc";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Xóa ảnh ${photo.name || ""}`);
      remove.addEventListener("click", () => deletePhoto(photo));
      card.append(image, caption, remove);
      els.photoGrid.append(card);
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

  function openNoteModal(parentId) {
    addParentId = parentId || null;
    $("modalKicker").textContent = addParentId ? "MỞ RỘNG Ý TƯỞNG" : "MỘT Ý TƯỞNG MỚI";
    $("modalTitle").textContent = addParentId ? "Thêm nhánh con" : "Thêm ghi chú";
    els.noteInput.value = "";
    els.modalBackdrop.hidden = false;
    window.setTimeout(() => els.noteInput.focus(), 0);
  }

  function closeNoteModal() {
    els.modalBackdrop.hidden = true;
    addParentId = null;
    els.noteForm.reset();
  }

  function findNode(nodes, id) {
    for (const node of nodes) {
      if (node.id === id) return node;
      const match = findNode(Array.isArray(node.children) ? node.children : [], id);
      if (match) return match;
    }
    return null;
  }

  function saveNode(text) {
    const roots = state.days[selectedDate] || (state.days[selectedDate] = []);
    const newNode = { id: uid(), text, done: false, children: [] };
    if (addParentId) {
      const parent = findNode(roots, addParentId);
      if (!parent) {
        showToast("Không tìm thấy nhánh cần thêm ghi chú.");
        return;
      }
      if (!Array.isArray(parent.children)) parent.children = [];
      parent.children.push(newNode);
    } else {
      roots.push(newNode);
    }
    closeNoteModal();
    persistState();
    renderCalendar();
    renderDay();
  }

  function updateTripDetails() {
    state.tripTitle = els.tripTitle.textContent.trim() || "Một chuyến đi thật xa";
    els.tripTitle.textContent = state.tripTitle;
    state.destination = els.destinationInput.value.trim() || "Chưa chọn điểm đến";
    els.destinationInput.value = state.destination;
    persistState();
  }

  function updateGoogleButton() {
    if (accessToken) {
      els.googleButtonText.textContent = "Đã kết nối Google";
      setSyncStatus("", "Đã đồng bộ Google Drive");
    }
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
          updateGoogleButton();
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
  $("todayRailButton").addEventListener("click", goToToday);
  $("todayDateLabel").textContent = `${today.getDate()}/${today.getMonth() + 1}`;
  $("addRootButton").addEventListener("click", () => openNoteModal(null));
  $("emptyAddButton").addEventListener("click", () => openNoteModal(null));
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
  $("editDayNoteButton").addEventListener("click", () => {
    const updated = window.prompt("Ghi một lời nhắn nhỏ cho ngày này:", state.dayNotes[selectedDate] || "");
    if (updated === null) return;
    state.dayNotes[selectedDate] = updated.trim();
    persistState();
    renderDay();
  });
  els.dayPlanInput.addEventListener("input", () => {
    const details = getDayDetails();
    const hadPlan = Boolean(details.plan);
    details.plan = els.dayPlanInput.value;
    if (!hadPlan && details.plan) renderCalendar();
    window.clearTimeout(planSaveTimer);
    planSaveTimer = window.setTimeout(persistState, 450);
  });
  els.dayPlanInput.addEventListener("blur", () => {
    window.clearTimeout(planSaveTimer);
    persistState();
  });
  $("itineraryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("itineraryText").value.trim();
    if (!text) return;
    getDayDetails().itinerary.push({
      id: uid(),
      time: $("itineraryTime").value,
      text,
      done: false
    });
    $("itineraryForm").reset();
    persistState();
    renderCalendar();
    renderDay();
  });
  $("expenseForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("expenseText").value.trim();
    const amount = Number($("expenseAmount").value);
    if (!text || !Number.isFinite(amount) || amount < 0) return;
    getDayDetails().expenses.push({
      id: uid(),
      text,
      category: $("expenseCategory").value.trim(),
      amount
    });
    $("expenseForm").reset();
    persistState();
    renderCalendar();
    renderDay();
  });
  $("photoInput").addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const details = getDayDetails();
    const failures = [];
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file);
        details.photos.push({
          id: uid(),
          name: file.name,
          mimeType: dataUrl.slice(5, dataUrl.indexOf(";")),
          dataUrl
        });
      } catch (error) {
        console.error(`Could not add photo "${file.name}".`, error);
        failures.push(file.name);
      }
    }
    event.target.value = "";
    if (files.length !== failures.length) {
      persistState();
      renderCalendar();
      renderDay();
    }
    if (failures.length) showToast(`Không thể thêm ${failures.length} ảnh. Tệp cần là ảnh hợp lệ và nhỏ hơn 15 MB.`);
  });
  $("modalClose").addEventListener("click", closeNoteModal);
  $("modalCancel").addEventListener("click", closeNoteModal);
  els.modalBackdrop.addEventListener("click", (event) => {
    if (event.target === els.modalBackdrop) closeNoteModal();
  });
  els.noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.noteInput.value.trim();
    if (text) saveNode(text);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.modalBackdrop.hidden) closeNoteModal();
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
