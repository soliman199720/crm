/**
 * ودجت المحادثات الفورية والشات الاحترافي (CRM Team & Private Chat Widget)
 * يدعم: محادثات الجروب العام، المحادثات الخاصة (1-on-1)، ومسح الشات من الإعدادات للأونر
 */

(function () {
  let isChatOpen = false;
  let currentUser = null;
  let teamMembers = [];
  let sseSource = null;

  // حالة الشات النشط: إما { type: 'group' } أو { type: 'private', user: { id, full_name, role } }
  let currentChat = { type: 'group' };
  
  // مخزن الرسائل:
  // groupMessages = []
  // privateMessages = { [otherUserId]: [] }
  let groupMessages = [];
  let privateMessages = {};

  // العدادات غير المقروءة:
  let unreadGroupCount = 0;
  let unreadPrivateCounts = {}; // { [userId]: count }

  // مؤشرات القوائم المنبثقة
  let isMembersPanelOpen = false;
  let isSettingsPanelOpen = false;
  let pendingChatAttachment = null;

  document.addEventListener('DOMContentLoaded', () => {
    initChatWidget();
  });

  // 1. حقن عناصر الشات في الصفحة
  function initChatWidget() {
    if (document.getElementById('chatFloatingBtn')) return;

    const widgetHtml = `
      <!-- زر المحادثة العائم الحديث -->
      <button class="chat-floating-btn" id="chatFloatingBtn" title="محادثة فريق المبيعات والإدارة" onclick="toggleChatWidget()">
        <span class="chat-btn-icon-wrapper">
          <i class="fa-solid fa-comments chat-icon-open"></i>
          <i class="fa-solid fa-xmark chat-icon-close"></i>
        </span>
        <span class="chat-unread-badge d-none" id="chatUnreadBadge" style="display:none;"></span>
      </button>

      <!-- كارت نافذة الشات -->
      <div class="chat-widget-card d-none" id="chatWidgetCard">
        <!-- الرأس (Header) -->
        <div class="chat-widget-header">
          <div class="chat-header-main">
            <!-- زر العودة للجروب عند التواجد في محادثة خاصة -->
            <button class="chat-header-back-btn d-none" id="chatHeaderBackBtn" onclick="switchToGroupChat()" title="العودة لجروب الفريق">
              <i class="fa-solid fa-arrow-right"></i>
            </button>

            <!-- معلومات المحادثة الحالية -->
            <div class="chat-header-info" id="chatHeaderInfo" onclick="toggleMembersPanel()">
              <div class="chat-header-avatar" id="chatHeaderAvatar">
                <i class="fa-solid fa-comments"></i>
              </div>
              <div class="chat-header-text">
                <strong id="chatHeaderTitle">جروب المبيعات والإدارة 💬</strong>
                <small id="chatHeaderSubtitle">جاري الاتصال...</small>
              </div>
            </div>
          </div>

          <!-- أزرار الإجراءات في الرأس -->
          <div class="chat-header-actions">
            <!-- زر أعضاء الفريق والمحادثات الخاصة -->
            <button class="chat-btn-icon" id="chatMembersBtn" onclick="toggleMembersPanel()" title="أعضاء الفريق والمحادثات الخاصة">
              <i class="fa-solid fa-user-group"></i>
            </button>

            <!-- زر إعدادات الشات (خاص بالمالك / الأونر فقط) -->
            <button class="chat-btn-icon d-none" id="chatSettingsBtn" onclick="toggleSettingsPanel()" title="إعدادات الشات ومسح المحادثات (للأونر)">
              <i class="fa-solid fa-gear"></i>
            </button>

            <!-- زر الإغلاق / التصغير -->
            <button class="chat-btn-icon" onclick="toggleChatWidget(false)" title="تصغير">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        <!-- شريط التبويبات العلوي (جروب الفريق | المحادثات الخاصة) -->
        <div class="chat-tabs-bar" id="chatTabsBar">
          <button class="chat-tab-btn active" id="tabBtnGroup" onclick="switchToGroupChat()">
            <i class="fa-solid fa-users"></i>
            <span>جروب الفريق</span>
            <span class="chat-tab-badge d-none" id="tabBadgeGroup">0</span>
          </button>
          <button class="chat-tab-btn" id="tabBtnPrivate" onclick="openMembersForPrivateChat()">
            <i class="fa-solid fa-lock"></i>
            <span>محادثة خاصة</span>
            <span class="chat-tab-badge d-none" id="tabBadgePrivate">0</span>
          </button>
        </div>

        <!-- لوحة أعضاء الفريق وبدء المحادثات الخاصة -->
        <div class="chat-members-panel d-none" id="chatMembersPanel">
          <div class="chat-members-panel-header">
            <h5>
              <i class="fa-solid fa-user-shield text-purple"></i>
              <span>فريق العمل (اختر موظفاً للمحادثة الخاصة)</span>
            </h5>
            <button class="chat-btn-icon" style="color:#64748b;" onclick="toggleMembersPanel(false)">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="chat-members-list-scroll" id="chatMembersListContainer"></div>
        </div>

        <!-- لوحة إعدادات الشات والتحكم (خاص بالأونر) -->
        <div class="chat-settings-panel d-none" id="chatSettingsPanel">
          <div class="chat-settings-title">
            <i class="fa-solid fa-sliders text-amber"></i>
            <span>إعدادات الشات والتحكم (المالك)</span>
          </div>
          <p class="chat-settings-desc">
            التحكم في مسح سجل المحادثات الفورية وإدارة التخزين.
          </p>
          <div class="chat-settings-schedule-badge">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>المسح التلقائي: كل خميس 12:00 ليلاً (مفعل ✅)</span>
          </div>
          <div class="chat-settings-actions">
            <button type="button" class="chat-btn-setting-danger" onclick="promptClearChat('group')">
              <i class="fa-solid fa-broom"></i>
              <span>مسح محادثات الجروب العام</span>
            </button>
            <button type="button" class="chat-btn-setting-danger" onclick="promptClearChat('all')">
              <i class="fa-solid fa-trash-can"></i>
              <span>مسح الشات بالكامل (كافة المحادثات)</span>
            </button>
          </div>
        </div>

        <!-- صندوق عرض الرسائل -->
        <div class="chat-messages-container" id="chatMessagesContainer" onscroll="handleChatScroll()">
          <div class="chat-system-pill" id="chatSystemPill">
            <i class="fa-solid fa-clock-rotate-left" style="margin-left:4px; color:#10b981;"></i>
            محادثة مباشرة بين الأونر وفريق السيلز • يتم مسح الشات تلقائياً كل خميس الساعة 12:00 ليلاً 🧹
          </div>
          <div id="chatMessagesFeed" style="display:flex; flex-direction:column; gap:8px;"></div>

          <!-- زر العودة لأسفل الرسائل -->
          <button class="chat-scroll-bottom-btn d-none" id="chatScrollBottomBtn" onclick="scrollChatToBottom(true)" title="أحدث الرسائل">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>

        <!-- معاينة المرفق المختار قبل الإرسال -->
        <div id="chatAttachmentPreview" class="d-none" style="display:none;padding:8px 12px;background:#f8fafc;border-top:1px solid #e2e8f0;align-items:center;justify-content:space-between;gap:8px;font-size:0.82rem;"></div>

        <!-- شريط الإدخال في الأسفل -->
        <form class="chat-widget-footer" onsubmit="handleSendChatMessage(event)">
          <input type="file" id="chatFileInput" accept="image/*,.pdf,.xlsx,.xls,.csv" style="display:none;" onchange="handleChatFileSelected(event)">
          <button type="button" id="chatAttachBtn" onclick="document.getElementById('chatFileInput').click()" title="إرفاق صورة أو ملف PDF / Excel" style="border:none;background:#f1f5f9;color:#475569;width:38px;height:38px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fa-solid fa-paperclip"></i>
          </button>
          <div class="chat-input-wrapper">
            <input 
              type="text" 
              class="chat-input-field" 
              id="chatInputField" 
              placeholder="اكتب رسالة للجروب..." 
              autocomplete="off"
            >
          </div>
          <button type="submit" class="chat-send-btn" id="chatSendBtn" title="إرسال (Enter)">
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        </form>
      </div>

      <!-- نافذة تأكيد مسح الشات المنبثقة للأونر (على كامل الشاشة) -->
      <div class="chat-confirm-modal-overlay d-none" id="chatConfirmModalOverlay" onclick="handleChatModalBackdropClick(event)" style="display:none;">
        <div class="chat-confirm-card" onclick="event.stopPropagation()">
          <div class="chat-confirm-icon-box">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <h4 id="chatConfirmTitle">تأكيد مسح المحادثات</h4>
          <p id="chatConfirmDesc">هل أنت متأكد من رغبتك في مسح سجل المحادثات نهائياً من قاعدة البيانات؟</p>
          <div class="chat-confirm-actions">
            <button type="button" class="btn-chat-cancel" onclick="closeChatConfirmModal()">
              <i class="fa-solid fa-xmark"></i>
              <span>تراجع وإلغاء</span>
            </button>
            <button type="button" class="btn-chat-danger-exec" id="btnExecuteChatClear" onclick="executeChatClear()">
              <i class="fa-solid fa-trash-can"></i>
              <span>نعم، مسح الآن</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.id = 'whatsappChatWrapper';
    container.innerHTML = widgetHtml;
    document.body.appendChild(container);

    // ربط اختصارات لوحة المفاتيح
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (isSettingsPanelOpen) toggleSettingsPanel(false);
        else if (isMembersPanelOpen) toggleMembersPanel(false);
        else if (isChatOpen) toggleChatWidget(false);
      }
    });

    // تحميل البيانات وبدء الاتصال اللحظي
    loadInitialChatData();
    setupSseConnection();
  }

  // 2. جلب الرسائل الأولية وبيانات المستخدم الحالي وأعضاء الفريق
  async function loadInitialChatData() {
    try {
      const [msgRes, membersRes] = await Promise.all([
        fetch('/api/chat/messages?limit=150'),
        fetch('/api/chat/members')
      ]);

      const msgData = await msgRes.json();
      if (msgData.success) {
        currentUser = msgData.currentUser;
        groupMessages = msgData.messages || [];

        // إظهار زر الإعدادات للأونر فقط
        const isOwner = currentUser && (
          (currentUser.role && (currentUser.role.includes('Owner') || currentUser.role.includes('المالك'))) ||
          currentUser.name === 'المدير العام'
        );
        const settingsBtn = document.getElementById('chatSettingsBtn');
        if (settingsBtn && isOwner) {
          settingsBtn.classList.remove('d-none');
        }

        renderCurrentConversation();
      }

      const membersData = await membersRes.json();
      if (membersData.success && membersData.members) {
        teamMembers = membersData.members;
        renderMembersList();
      }
    } catch (err) {
      console.warn('تنبيه الشات: لم يتمكن من الاتصال بالخادم حالياً:', err.message);
    }
  }

  // 3. الاتصال اللحظي عبر Server-Sent Events (SSE)
  function setupSseConnection() {
    if (sseSource) sseSource.close();

    try {
      sseSource = new EventSource('/api/chat/stream');

      sseSource.onopen = () => {
        updateHeaderSubtitle();
      };

      sseSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // في حال كان الحدث مسحاً للشات
          if (data.type === 'chat_cleared') {
            handleChatClearedEvent(data);
            return;
          }

          // رسالة جديدة واردة
          onNewMessageReceived(data);
        } catch (e) {
          console.error('خطأ معالجة رسالة SSE:', e);
        }
      };

      sseSource.onerror = async () => {
        const subtitle = document.getElementById('chatHeaderSubtitle');
        try {
          const authCheck = await fetch('/api/me');
          if (authCheck.status === 401 || authCheck.status === 403) {
            if (sseSource) {
              sseSource.close();
              sseSource = null;
            }
            if (subtitle) subtitle.textContent = 'انتهت الجلسة، يرجى تسجيل الدخول';
            return;
          }
        } catch (_) {}
        if (subtitle) subtitle.textContent = 'إعادة الاتصال بالخادم...';
      };
    } catch (err) {
      console.warn('SSE غير متاح حالياً:', err);
    }
  }

  // 4. معالجة وصول رسالة جديدة
  function onNewMessageReceived(msg) {
    const isPrivate = msg.chat_type === 'private' && msg.recipient_id;
    const myId = currentUser ? currentUser.id : null;

    if (isPrivate) {
      // التحقق أن الرسالة تخصني (أنا الراسل أو أنا المستلم)
      if (msg.sender_id !== myId && msg.recipient_id !== myId) {
        return; // ليست موجهة لي
      }

      const otherUserId = (msg.sender_id === myId) ? msg.recipient_id : msg.sender_id;
      if (!privateMessages[otherUserId]) privateMessages[otherUserId] = [];
      
      // منع التكرار
      if (privateMessages[otherUserId].some(m => m.id === msg.id)) return;
      privateMessages[otherUserId].push(msg);

      // هل هذه المحادثة الخاصة مفتوحة حالياً؟
      if (isChatOpen && currentChat.type === 'private' && currentChat.user.id === otherUserId) {
        appendSingleMessage(msg);
      } else {
        // زيادة عداد غير المقروء لهذه المحادثة الخاصة
        if (msg.sender_id !== myId) {
          unreadPrivateCounts[otherUserId] = (unreadPrivateCounts[otherUserId] || 0) + 1;
          updateUnreadBadge();
          playMessageSound();
        }
      }
    } else {
      // رسالة جروب عام
      if (groupMessages.some(m => m.id === msg.id)) return;
      groupMessages.push(msg);

      if (isChatOpen && currentChat.type === 'group') {
        appendSingleMessage(msg);
      } else {
        if (!currentUser || msg.sender_id !== currentUser.id) {
          unreadGroupCount++;
          updateUnreadBadge();
          playMessageSound();
        }
      }
    }
  }

  // 5. رسم المحادثة الحالية
  function renderCurrentConversation() {
    const feed = document.getElementById('chatMessagesFeed');
    const systemPill = document.getElementById('chatSystemPill');
    const input = document.getElementById('chatInputField');
    if (!feed) return;

    feed.innerHTML = '';

    if (currentChat.type === 'private') {
      const otherUser = currentChat.user;
      if (systemPill) {
        systemPill.innerHTML = `
          <i class="fa-solid fa-lock" style="margin-left:4px; color:#2563eb;"></i>
          محادثة خاصة ومباشرة بينك وبين <b>${escapeHtml(otherUser.full_name || 'الموظف')}</b> - لا يراها أحد سواكما 🔒
        `;
      }
      if (input) {
        input.placeholder = `اكتب رسالة خاصة لـ ${otherUser.full_name || 'الموظف'}...`;
      }

      const msgs = privateMessages[otherUser.id] || [];
      if (msgs.length === 0) {
        feed.innerHTML = `
          <div style="text-align:center; padding:30px 10px; color:#94a3b8;">
            <i class="fa-solid fa-comments" style="font-size:2.2rem; opacity:0.4; margin-bottom:8px;"></i>
            <p style="font-size:0.82rem; margin:0;">لا توجد رسائل سابقة. ابدأ المحادثة الخاصة الآن!</p>
          </div>
        `;
      } else {
        renderMessagesWithDates(feed, msgs);
      }
    } else {
      // جروب عام
      if (systemPill) {
        systemPill.innerHTML = `
          <i class="fa-solid fa-clock-rotate-left" style="margin-left:4px; color:#10b981;"></i>
          محادثة مباشرة بين الأونر وفريق السيلز • يتم مسح الشات تلقائياً كل خميس الساعة 12:00 ليلاً 🧹
        `;
      }
      if (input) {
        input.placeholder = 'اكتب رسالة لجروب الفريق...';
      }

      if (groupMessages.length === 0) {
        feed.innerHTML = `
          <div style="text-align:center; padding:30px 10px; color:#94a3b8;">
            <i class="fa-solid fa-users" style="font-size:2.2rem; opacity:0.4; margin-bottom:8px;"></i>
            <p style="font-size:0.82rem; margin:0;">مرحباً بكم في شات الفريق! اكتب أول رسالة للمجموعة.</p>
          </div>
        `;
      } else {
        renderMessagesWithDates(feed, groupMessages);
      }
    }

    scrollChatToBottom(false);
  }

  // رسم الرسائل مع فواصل التواريخ (Date Separators)
  function renderMessagesWithDates(container, msgs) {
    let lastDateStr = '';

    msgs.forEach(msg => {
      const msgDateStr = formatDateSeparator(msg.created_at);
      if (msgDateStr !== lastDateStr) {
        const dateSep = document.createElement('div');
        dateSep.className = 'chat-date-separator';
        dateSep.textContent = msgDateStr;
        container.appendChild(dateSep);
        lastDateStr = msgDateStr;
      }
      container.appendChild(createMessageElement(msg));
    });
  }

  // 6. إضافة رسالة واحدة لنهاية المحادثة
  function appendSingleMessage(msg) {
    const feed = document.getElementById('chatMessagesFeed');
    if (!feed) return;

    // إزالة رسالة "لا توجد رسائل" إن وجدت
    if (feed.querySelector('.fa-comments, .fa-users')) {
      feed.innerHTML = '';
    }

    feed.appendChild(createMessageElement(msg));
    scrollChatToBottom(true);
  }

  // 7. بناء عنصر الرسالة بتنسيق فقاعة الواتساب الصحيح للـ RTL
  function createMessageElement(msg) {
    const isMe = currentUser && (msg.sender_id === currentUser.id);
    const isOwner = msg.sender_role && (msg.sender_role.includes('Owner') || msg.sender_role.includes('المالك'));
    
    const bubble = document.createElement('div');
    // outgoing في RTL تظهر على اليسار، incoming تظهر على اليمين
    bubble.className = `chat-bubble ${isMe ? 'outgoing' : 'incoming'}`;

    const timeStr = formatMsgTime(msg.created_at);

    let senderLabel = '';
    if (!isMe && currentChat.type === 'group') {
      const roleBadge = isOwner 
        ? '<i class="fa-solid fa-crown text-amber"></i> أونر' 
        : '<i class="fa-solid fa-headset"></i> سيلز';
      senderLabel = `
        <span class="chat-bubble-sender ${isOwner ? 'sender-owner' : 'sender-sales'}">
          ${escapeHtml(msg.sender_name)} <small style="font-weight:600; opacity:0.85;">(${roleBadge})</small>
        </span>
      `;
    }

    let attachmentHtml = '';
    if (msg.attachment_url && typeof msg.attachment_url === 'string' && msg.attachment_url.startsWith('/uploads/chat/')) {
      const safeUrl = escapeHtml(msg.attachment_url);
      const safeName = escapeHtml(msg.attachment_name || 'ملف مرفق');
      if (msg.attachment_type === 'image') {
        attachmentHtml = `
          <div style="margin-bottom:6px;">
            <a href="${safeUrl}" target="_blank" rel="noopener" title="فتح الصورة بحجم كامل">
              <img src="${safeUrl}" alt="${safeName}" loading="lazy" style="max-width:220px;max-height:220px;border-radius:10px;display:block;object-fit:cover;border:1px solid rgba(0,0,0,0.08);">
            </a>
            <a href="${safeUrl}" download="${safeName}" style="display:inline-flex;align-items:center;gap:5px;margin-top:5px;font-size:0.75rem;font-weight:700;color:inherit;opacity:0.9;text-decoration:none;background:rgba(0,0,0,0.08);padding:3px 9px;border-radius:8px;">
              <i class="fa-solid fa-download"></i> حفظ الصورة
            </a>
          </div>
        `;
      } else {
        const isPdf = msg.attachment_type === 'pdf';
        const fileIcon = isPdf ? 'fa-file-pdf' : 'fa-file-excel';
        const iconColor = isPdf ? '#dc2626' : '#16a34a';
        attachmentHtml = `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(255,255,255,0.88);color:#0f172a;padding:8px 10px;border-radius:10px;margin-bottom:6px;border:1px solid rgba(15,23,42,0.1);">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <i class="fa-solid ${fileIcon}" style="font-size:1.3rem;color:${iconColor};flex-shrink:0;"></i>
              <span style="font-size:0.82rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;" title="${safeName}">${safeName}</span>
            </div>
            <a href="${safeUrl}" download="${safeName}" style="padding:4px 10px;border-radius:8px;background:#0f172a;color:#ffffff;font-size:0.74rem;font-weight:700;text-decoration:none;flex-shrink:0;">
              <i class="fa-solid fa-download"></i> تحميل
            </a>
          </div>
        `;
      }
    }

    bubble.innerHTML = `
      ${senderLabel}
      ${attachmentHtml}
      ${msg.message ? `<div class="chat-bubble-text">${escapeHtml(msg.message)}</div>` : ''}
      <div class="chat-bubble-meta">
        <span>${timeStr}</span>
        ${isMe ? '<i class="fa-solid fa-check-double" title="تم الإرسال"></i>' : ''}
      </div>
    `;

    return bubble;
  }

  // 7.1 اختيار ومعاينة مرفق الشات (صورة / PDF / Excel)
  window.handleChatFileSelected = function (e) {
    const file = e.target && e.target.files && e.target.files[0];
    if (!file) return;

    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      showChatNotice('الحد الأقصى لحجم الملف هو 10 ميجابايت');
      e.target.value = '';
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isExcel = /\.(xlsx|xls|csv)$/i.test(lowerName) ||
      file.type.includes('spreadsheet') ||
      file.type.includes('excel') ||
      file.type === 'text/csv';

    if (!isImage && !isPdf && !isExcel) {
      showChatNotice('الصيغ المسموحة فقط: الصور، PDF، أو ملفات الإكسيل');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      pendingChatAttachment = { name: file.name, dataUrl: reader.result };
      const preview = document.getElementById('chatAttachmentPreview');
      if (preview) {
        preview.classList.remove('d-none');
        preview.style.display = 'flex';
        preview.innerHTML = `
          <span style="display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#0f172a;font-weight:700;">
            <i class="fa-solid ${isImage ? 'fa-image text-emerald' : (isPdf ? 'fa-file-pdf' : 'fa-file-excel')}" style="color:${isImage ? '#10b981' : (isPdf ? '#dc2626' : '#16a34a')};"></i>
            <span>${escapeHtml(file.name)}</span>
          </span>
          <button type="button" onclick="clearChatAttachment()" style="border:none;background:#fee2e2;color:#b91c1c;width:24px;height:24px;border-radius:6px;cursor:pointer;font-weight:800;">&times;</button>
        `;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  window.clearChatAttachment = function () {
    pendingChatAttachment = null;
    const preview = document.getElementById('chatAttachmentPreview');
    if (preview) {
      preview.classList.add('d-none');
      preview.style.display = 'none';
      preview.innerHTML = '';
    }
  };

  // 8. إرسال رسالة جديدة
  window.handleSendChatMessage = async function (e) {
    if (e) e.preventDefault();

    const input = document.getElementById('chatInputField');
    const sendBtn = document.getElementById('chatSendBtn');
    const message = (input.value || '').trim();
    const attachmentToSend = pendingChatAttachment;

    if (!message && !attachmentToSend) return;

    input.value = '';
    input.focus();
    clearChatAttachment();
    sendBtn.disabled = true;

    try {
      const payload = {
        message,
        chat_type: currentChat.type,
        recipient_id: currentChat.type === 'private' ? currentChat.user.id : null,
        attachment: attachmentToSend || null
      };

      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!data.success) {
        showChatNotice(data.message || 'فشل إرسال الرسالة');
      }
    } catch (err) {
      console.error('خطأ إرسال الرسالة:', err);
      showChatNotice('تعذر إرسال الرسالة أو حجم المرفق كبير جداً');
    } finally {
      sendBtn.disabled = false;
    }
  };

  // 9. التحويل إلى محادثة خاصة مع موظف
  window.startPrivateChatWith = async function (targetUserId) {
    const member = teamMembers.find(m => m.id === targetUserId);
    if (!member) return;

    currentChat = {
      type: 'private',
      user: member
    };

    // إغلاق لوحة الأعضاء وتحديث الرأس
    toggleMembersPanel(false);
    updateHeaderForCurrentChat();

    // تصفير عداد هذه المحادثة الخاصة
    delete unreadPrivateCounts[member.id];
    updateUnreadBadge();

    // جلب أرشيف هذه المحادثة الخاصة إذا لم تكن محملة
    try {
      const res = await fetch(`/api/chat/messages?type=private&withUserId=${member.id}&limit=120`);
      const data = await res.json();
      if (data.success) {
        privateMessages[member.id] = data.messages || [];
      }
    } catch (err) {
      console.error('خطأ جلب المحادثة الخاصة:', err);
    }

    renderCurrentConversation();
  };

  // 10. العودة للجروب العام
  window.switchToGroupChat = function () {
    currentChat = { type: 'group' };
    toggleMembersPanel(false);
    updateHeaderForCurrentChat();
    renderCurrentConversation();
  };

  // 11. تحديث عناصر الرأس والتبويبات حسب الشات النشط
  function updateHeaderForCurrentChat() {
    const backBtn = document.getElementById('chatHeaderBackBtn');
    const avatar = document.getElementById('chatHeaderAvatar');
    const title = document.getElementById('chatHeaderTitle');
    const tabGroup = document.getElementById('tabBtnGroup');
    const tabPrivate = document.getElementById('tabBtnPrivate');

    if (currentChat.type === 'private') {
      const user = currentChat.user;
      if (backBtn) backBtn.classList.remove('d-none');
      if (avatar) {
        avatar.className = 'chat-header-avatar avatar-private';
        avatar.innerHTML = '<i class="fa-solid fa-user-lock"></i>';
      }
      if (title) {
        title.innerHTML = `${escapeHtml(user.full_name || 'موظف')} <small style="font-weight:600; opacity:0.9;">(خاص)</small>`;
      }
      if (tabGroup) tabGroup.classList.remove('active');
      if (tabPrivate) tabPrivate.classList.add('active');
    } else {
      if (backBtn) backBtn.classList.add('d-none');
      if (avatar) {
        avatar.className = 'chat-header-avatar';
        avatar.innerHTML = '<i class="fa-solid fa-comments"></i>';
      }
      if (title) {
        title.textContent = 'جروب المبيعات والإدارة 💬';
      }
      if (tabGroup) tabGroup.classList.add('active');
      if (tabPrivate) tabPrivate.classList.remove('active');
    }

    updateHeaderSubtitle();
  }

  function updateHeaderSubtitle() {
    const subtitle = document.getElementById('chatHeaderSubtitle');
    if (!subtitle) return;

    if (currentChat.type === 'private') {
      const user = currentChat.user;
      const isOwner = user.role && (user.role.includes('Owner') || user.role.includes('المالك'));
      subtitle.textContent = isOwner ? 'المالك / المدير العام • محادثة خاصة 🔒' : 'موظف سيلز • محادثة خاصة 🔒';
    } else {
      const count = teamMembers.length || 1;
      subtitle.textContent = `متصل الآن • ${count} أعضاء`;
    }
  }

  // 12. رسم قائمة أعضاء الفريق
  function renderMembersList() {
    const container = document.getElementById('chatMembersListContainer');
    if (!container) return;

    container.innerHTML = '';
    const myId = currentUser ? currentUser.id : null;

    teamMembers.forEach(member => {
      const isMe = member.id === myId;
      const isOwner = member.role && (member.role.includes('Owner') || member.role.includes('المالك'));
      const unreadForMember = unreadPrivateCounts[member.id] || 0;

      const row = document.createElement('div');
      row.className = 'chat-member-row';
      row.onclick = () => {
        if (!isMe) startPrivateChatWith(member.id);
      };

      row.innerHTML = `
        <div class="chat-member-info-col">
          <div class="chat-member-avatar-box" style="background:${isOwner ? '#b45309' : '#7c3aed'};">
            ${isOwner ? '<i class="fa-solid fa-crown"></i>' : '<i class="fa-solid fa-user"></i>'}
            <span class="status-dot" title="متصل"></span>
          </div>
          <div class="chat-member-details">
            <strong>${escapeHtml(member.full_name || 'مستخدم')} ${isMe ? '<small style="color:#10b981;">(أنت)</small>' : ''}</strong>
            <span>${escapeHtml(member.role || 'سيلز')} &bull; ${escapeHtml(member.email || '')}</span>
          </div>
        </div>
        <div>
          ${isMe ? `
            <span style="font-size:0.75rem; color:#94a3b8; font-weight:700;">حسابك</span>
          ` : `
            <button class="chat-member-action-btn" type="button" onclick="event.stopPropagation(); startPrivateChatWith(${member.id});">
              <i class="fa-solid fa-comment-dots"></i>
              <span>محادثة خاصة</span>
              ${unreadForMember > 0 ? `<span class="chat-tab-badge">${unreadForMember}</span>` : ''}
            </button>
          `}
        </div>
      `;

      container.appendChild(row);
    });
  }

  // 13. التحكم في لوحات الأعضاء والإعدادات
  window.toggleMembersPanel = function (forceState) {
    const panel = document.getElementById('chatMembersPanel');
    const btn = document.getElementById('chatMembersBtn');
    if (!panel) return;

    if (typeof forceState === 'boolean') isMembersPanelOpen = forceState;
    else isMembersPanelOpen = !isMembersPanelOpen;

    if (isMembersPanelOpen) {
      panel.classList.remove('d-none');
      if (btn) btn.classList.add('active');
      toggleSettingsPanel(false);
      renderMembersList();
    } else {
      panel.classList.add('d-none');
      if (btn) btn.classList.remove('active');
    }
  };

  window.openMembersForPrivateChat = function () {
    toggleMembersPanel(true);
  };

  window.toggleSettingsPanel = function (forceState) {
    const panel = document.getElementById('chatSettingsPanel');
    const btn = document.getElementById('chatSettingsBtn');
    if (!panel) return;

    if (typeof forceState === 'boolean') isSettingsPanelOpen = forceState;
    else isSettingsPanelOpen = !isSettingsPanelOpen;

    if (isSettingsPanelOpen) {
      panel.classList.remove('d-none');
      if (btn) btn.classList.add('active');
      toggleMembersPanel(false);
    } else {
      panel.classList.add('d-none');
      if (btn) btn.classList.remove('active');
    }
  };

  // 14. مسح الشات للأونر مع نافذة التأكيد
  let pendingClearTarget = null;

  window.promptClearChat = function (target) {
    pendingClearTarget = target;
    
    // إغلاق أي لوحات منبثقة فوراً لمنع أي تداخل بصري
    toggleSettingsPanel(false);
    toggleMembersPanel(false);

    const overlay = document.getElementById('chatConfirmModalOverlay');
    const title = document.getElementById('chatConfirmTitle');
    const desc = document.getElementById('chatConfirmDesc');
    if (!overlay) return;

    if (target === 'group') {
      title.textContent = 'مسح محادثات الجروب العام';
      desc.textContent = 'هل أنت متأكد من مسح كافة رسائل جروب الفريق العام؟ ستظل المحادثات الخاصة محفوظة دون أي تغيير.';
    } else {
      title.textContent = 'مسح الشات بالكامل (كافة المحادثات)';
      desc.textContent = 'تنبيه: سيتم مسح وتصفير كافة رسائل الجروب العام وكافة المحادثات الخاصة نهائياً من قاعدة البيانات.';
    }

    overlay.classList.remove('d-none');
    overlay.style.display = 'flex';
  };

  window.closeChatConfirmModal = function () {
    const overlay = document.getElementById('chatConfirmModalOverlay');
    if (overlay) {
      overlay.classList.add('d-none');
      overlay.style.display = 'none';
    }
    pendingClearTarget = null;
  };

  window.handleChatModalBackdropClick = function (e) {
    if (e.target && e.target.id === 'chatConfirmModalOverlay') {
      closeChatConfirmModal();
    }
  };

  window.executeChatClear = async function () {
    if (!pendingClearTarget) return;

    const execBtn = document.getElementById('btnExecuteChatClear');
    if (execBtn) execBtn.disabled = true;

    try {
      const res = await fetch('/api/chat/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: pendingClearTarget })
      });

      const data = await res.json();
      if (data.success) {
        closeChatConfirmModal();
      } else {
        showChatNotice(data.message || 'فشل مسح الشات');
      }
    } catch (err) {
      console.error('خطأ مسح الشات:', err);
    } finally {
      if (execBtn) execBtn.disabled = false;
    }
  };

  // 15. معالجة حدث مسح الشات القادم من السيرفر
  function handleChatClearedEvent(data) {
    const target = data.target || 'all';

    if (target === 'group') {
      groupMessages = [];
      if (currentChat.type === 'group') {
        renderCurrentConversation();
      }
      unreadGroupCount = 0;
    } else if (target === 'all') {
      groupMessages = [];
      privateMessages = {};
      unreadGroupCount = 0;
      unreadPrivateCounts = {};
      renderCurrentConversation();
    }

    updateUnreadBadge();
  }

  // 16. فتح وإغلاق كارت الشات العائم
  window.toggleChatWidget = function (forceState) {
    const card = document.getElementById('chatWidgetCard');
    const btn = document.getElementById('chatFloatingBtn');
    if (!card || !btn) return;

    if (typeof forceState === 'boolean') isChatOpen = forceState;
    else isChatOpen = !isChatOpen;

    if (isChatOpen) {
      card.classList.remove('d-none');
      btn.classList.add('active');

      if (currentChat.type === 'group') unreadGroupCount = 0;
      else if (currentChat.type === 'private') delete unreadPrivateCounts[currentChat.user.id];

      updateUnreadBadge();
      scrollChatToBottom(false);

      setTimeout(() => {
        const inp = document.getElementById('chatInputField');
        if (inp) inp.focus();
      }, 150);
    } else {
      card.classList.add('d-none');
      btn.classList.remove('active');
      toggleMembersPanel(false);
      toggleSettingsPanel(false);
    }
  };

  // 17. تحديث شارة العدادات
  function updateUnreadBadge() {
    const badge = document.getElementById('chatUnreadBadge');
    const tabBadgeGrp = document.getElementById('tabBadgeGroup');
    const tabBadgePriv = document.getElementById('tabBadgePrivate');

    let totalPrivateUnread = 0;
    Object.values(unreadPrivateCounts).forEach(c => totalPrivateUnread += (c || 0));

    const totalUnread = unreadGroupCount + totalPrivateUnread;

    if (badge) {
      if (totalUnread > 0) {
        badge.textContent = totalUnread > 99 ? '+99' : totalUnread;
        badge.classList.remove('d-none');
        badge.style.display = 'flex';
      } else {
        badge.textContent = '';
        badge.classList.add('d-none');
        badge.style.display = 'none';
      }
    }

    if (tabBadgeGrp) {
      if (unreadGroupCount > 0) {
        tabBadgeGrp.textContent = unreadGroupCount;
        tabBadgeGrp.classList.remove('d-none');
        tabBadgeGrp.style.display = 'inline-flex';
      } else {
        tabBadgeGrp.textContent = '';
        tabBadgeGrp.classList.add('d-none');
        tabBadgeGrp.style.display = 'none';
      }
    }

    if (tabBadgePriv) {
      if (totalPrivateUnread > 0) {
        tabBadgePriv.textContent = totalPrivateUnread;
        tabBadgePriv.classList.remove('d-none');
        tabBadgePriv.style.display = 'inline-flex';
      } else {
        tabBadgePriv.textContent = '';
        tabBadgePriv.classList.add('d-none');
        tabBadgePriv.style.display = 'none';
      }
    }
  }

  // 18. التمرير السلس ومراقبة التمرير
  window.handleChatScroll = function () {
    const container = document.getElementById('chatMessagesContainer');
    const scrollBtn = document.getElementById('chatScrollBottomBtn');
    if (!container || !scrollBtn) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 120) {
      scrollBtn.classList.remove('d-none');
    } else {
      scrollBtn.classList.add('d-none');
    }
  };

  window.scrollChatToBottom = function (smooth) {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;

    setTimeout(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
      const scrollBtn = document.getElementById('chatScrollBottomBtn');
      if (scrollBtn) scrollBtn.classList.add('d-none');
    }, 60);
  };

  // 19. صوت الإشعار اللطيف عبر Web Audio API
  function playMessageSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  // 20. دوال مساعدة في التنسيق
  function formatMsgTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch (e) {
      return '';
    }
  }

  function formatDateSeparator(dateStr) {
    if (!dateStr) return 'اليوم';
    try {
      const d = new Date(dateStr);
      const today = new Date();
      if (d.toDateString() === today.toDateString()) return 'اليوم';

      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) return 'أمس';

      return d.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch (e) {
      return 'اليوم';
    }
  }

  function showChatNotice(message) {
    const existing = document.getElementById('chatWidgetNotice');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'chatWidgetNotice';
    toast.style.cssText = 'position:fixed;bottom:90px;left:24px;background:#dc2626;color:#fff;padding:10px 18px;border-radius:10px;z-index:10001;font-size:0.9rem;box-shadow:0 4px 14px rgba(0,0,0,0.25);';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
