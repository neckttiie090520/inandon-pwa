/* ====================================================================
   API Bridge — จำลอง google.script.run ด้วย fetch ไปยัง GAS headless API
   (Decoupled PWA: static shell + ContentService JSON, text/plain กัน preflight)
   ==================================================================== */
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwrCUiqAlE8P5EJ3iJ4w2aa3AoUgZ0MWYgq8uftNCUu2-aabMWgtyLbFTSK9xnEPzRF/exec";

(function () {
    function makeRunner() {
        const state = { success: null, failure: null };
        const runner = {
            withSuccessHandler: function (cb) { state.success = cb; return runner; },
            withFailureHandler: function (cb) { state.failure = cb; return runner; }
        };
        return new Proxy(runner, {
            get: function (target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== 'string') return undefined;
                return function () {
                    const args = Array.prototype.slice.call(arguments);
                    fetch(GAS_API_URL, {
                        method: 'POST',
                        mode: 'cors',
                        redirect: 'follow',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({ fn: prop, args: args })
                    })
                        .then(function (r) {
                            if (!r.ok) throw new Error('HTTP ' + r.status);
                            return r.json();
                        })
                        .then(function (res) {
                            if (res && res.__error) throw new Error(res.__error);
                            if (state.success) state.success(res);
                        })
                        .catch(function (err) {
                            if (state.failure) state.failure(err);
                            else console.error('API', prop, err);
                        });
                };
            }
        });
    }
    window.google = { script: {} };
    // ทุกครั้งที่เข้าถึง google.script.run จะได้ runner ใหม่ (เหมือนของจริง)
    Object.defineProperty(window.google.script, 'run', { get: makeRunner });
})();

/* Service Worker registration */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function (err) {
            console.warn('SW registration skipped:', err);
        });
    });
}

// ====================================================================
    // JavaScript Frontend Logic - ระบบบิลเงินสด อิน แอนด์ ออน เทเลอร์
    // Professional JavaScript for iPad, iPhone, Mobile
    // ====================================================================

    // Global Variables
    let currentCustomers = [];
    let currentHistory = [];
    let currentTab = 'create';
    let itemCounter = 0;
    let isLoading = false;

    // ====================================================================
    // App Initialization
    // ====================================================================

    function initializeApp() {
        try {
            // Hide loading overlay
            hideLoadingOverlay();

            // Apply saved dark/light theme
            applySavedTheme();

            // โหลดค่าลายเซ็นร้าน (เปิด/ปิด + มีไฟล์หรือยัง)
            loadPublicConfig();

            // Set default date to today
            setDefaultDate();

            // Initialize form
            addNewItem();

            // Set manifest URL
            setManifestUrl();

            // Load initial data
            loadInitialData();

            // Setup event listeners
            setupEventListeners();

            console.log('✅ App initialized successfully');
        } catch (error) {
            console.error('❌ Error initializing app:', error);
            showError('เกิดข้อผิดพลาดในการโหลดระบบ กรุณารีเฟรชหน้าเว็บ');
        }
    }

    function hideLoadingOverlay() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
            setTimeout(() => overlay.style.display = 'none', 300);
        }
    }

    // วันที่ท้องถิ่นแบบ yyyy-mm-dd (toISOString เป็น UTC — ก่อน 07:00 ของไทยจะได้เมื่อวาน) (BUG-7)
    function localDateStr(date) {
        const d = date || new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function setDefaultDate() {
        const dateInput = document.getElementById('documentDate');
        if (dateInput) {
            dateInput.value = localDateStr();
        }

        // Set valid until date (30 days from today) for quotations
        const validUntilInput = document.getElementById('validUntil');
        if (validUntilInput) {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);
            validUntilInput.value = localDateStr(futureDate);
        }
    }

    function setManifestUrl() {
        // PWA shell ใช้ manifest.webmanifest ท้องถิ่น — ไม่ต้องทำอะไร
    }

    function loadInitialData() {
        // ประวัติล่าสุดจะโหลดเมื่อเปิดแท็บประวัติเท่านั้น — ไม่เสีย roundtrip ตอนเปิดแอป (BUG-18)
    }

    function setupEventListeners() {
        // Form validation
        const inputs = document.querySelectorAll('input[required], textarea[required]');
        inputs.forEach(input => {
            input.addEventListener('blur', validateField);
            input.addEventListener('input', clearFieldError);
        });

        // Auto-save form data to localStorage
        const formElements = document.querySelectorAll('#customerForm input, #customerForm textarea, #customerForm select');
        formElements.forEach(element => {
            element.addEventListener('change', saveFormToStorage);
        });

        // Load saved form data
        loadFormFromStorage();
    }

    // ====================================================================
    // Tab Management
    // ====================================================================

    function switchTab(tabName) {
        if (isLoading) return;

        // Update bottom nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`.nav-item[data-tab="${tabName}"]`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}Tab`).classList.add('active');

        currentTab = tabName;

        // Load tab-specific data
        switch (tabName) {
            case 'history':
                loadHistoryData();
                break;
            case 'customers':
                loadCustomersData();
                break;
        }
    }

    // ====================================================================
    // Document Type Management
    // ====================================================================

    function updateDocumentType() {
        const selectedType = document.querySelector('input[name="documentType"]:checked').value;
        const validUntilGroup = document.getElementById('validUntilGroup');
        const submitBtn = document.getElementById('submitBtn');

        // เฉพาะใบเสนอราคาที่มีวันยืนราคา — บิลทุกหัวไม่มีวันหมดอายุ
        if (selectedType === 'ใบเสนอราคา') {
            validUntilGroup.style.display = 'block';
            submitBtn.innerHTML = '<i class="ti ti-circle-check"></i> สร้างใบเสนอราคา';
        } else {
            validUntilGroup.style.display = 'none';
            submitBtn.innerHTML = '<i class="ti ti-circle-check"></i> สร้าง' + selectedType;
        }

        updateSummaryCard();
    }

    // คืน {note, depositPercent, shopSignature, customerSignatureDataUrl} จากฟอร์ม
    function getExtraOptions() {
        const depositSelect = document.getElementById('depositSelect');
        let depositPercent = depositSelect ? depositSelect.value : '';
        if (depositPercent === 'custom') {
            depositPercent = parseFloat(document.getElementById('depositCustom')?.value) || '';
        }
        return {
            note: document.getElementById('documentNote')?.value.trim() || '',
            depositPercent: depositPercent,
            shopSignature: document.getElementById('shopSignatureToggle')?.checked !== false,
            customerSignatureDataUrl: customerSignatureDataUrl || ''
        };
    }

    // แสดงยอดมัดจำ/คงเหลือแบบสด ๆ ตอนกรอก
    function updateDepositPreview() {
        const depositSelect = document.getElementById('depositSelect');
        const customGroup = document.getElementById('customDepositGroup');
        const preview = document.getElementById('depositPreview');
        if (!depositSelect) return;

        customGroup.style.display = depositSelect.value === 'custom' ? 'block' : 'none';

        let pct = depositSelect.value;
        if (pct === 'custom') pct = parseFloat(document.getElementById('depositCustom')?.value) || 0;
        pct = parseFloat(pct);

        const total = getCurrentItemsTotal();
        const dep = (pct && total > 0) ? computeDeposit(total, pct) : null;

        if (dep) {
            preview.style.display = 'block';
            preview.innerHTML = 'มัดจำ ' + dep.percent + '% = <strong>' + formatCurrency(dep.deposit) +
                '</strong> บาท | คงเหลือ <strong>' + formatCurrency(dep.remaining) + '</strong> บาท';
        } else {
            preview.style.display = 'none';
            preview.innerHTML = '';
        }
        // ห้ามเรียก updateSummary() กลับ — ผู้เรียก (updateSummary) รับผิดชอบเอง กัน recursion
    }

    function getCurrentItemsTotal() {
        let total = 0;
        document.querySelectorAll('.item-card').forEach(item => {
            const id = item.id.split('_')[1];
            const qty = parseFloat(document.getElementById('qty_' + id)?.value) || 0;
            const price = parseFloat(document.getElementById('price_' + id)?.value) || 0;
            const desc = document.getElementById('desc_' + id)?.value?.trim() || '';
            if (desc && qty > 0) total += qty * price;
        });
        return total;
    }

    // computeDeposit เวอร์ชัน frontend — สูตรเดียวกับ backend
    function computeDeposit(totalAmount, depositPercent) {
        if (depositPercent === null || depositPercent === undefined || depositPercent === '') return null;
        const pct = parseFloat(depositPercent);
        if (isNaN(pct) || pct <= 0) return null;
        const capped = Math.min(pct, 100);
        const deposit = Math.round(totalAmount * capped) / 100;
        return { percent: capped, deposit: deposit, remaining: Math.round((totalAmount - deposit) * 100) / 100 };
    }

    // ====================================================================
    // Item Management
    // ====================================================================

    function addNewItem() {
        itemCounter++;
        const container = document.getElementById('itemsContainer');

        const itemCard = document.createElement('div');
        itemCard.className = 'item-card';
        itemCard.id = `item_${itemCounter}`;

        itemCard.innerHTML = `
    <div class="item-header">
      <span class="item-number">รายการที่ ${itemCounter}</span>
      ${itemCounter > 1 ? `<button type="button" class="btn-remove" onclick="removeItem(${itemCounter})">&times;</button>` : ''}
    </div>
    <div class="item-fields">
      <div class="form-group">
        <label for="desc_${itemCounter}">รายการสินค้า/บริการ <span class="required">*</span></label>
        <input type="text" id="desc_${itemCounter}" class="form-control" 
               oninput="updateSummary()" required 
               placeholder="เช่น งานเย็บผ้าสำหรับชุดสูท">
      </div>
      <div class="form-group">
        <label for="qty_${itemCounter}">จำนวน</label>
        <input type="number" id="qty_${itemCounter}" class="form-control" 
               value="1" min="0" step="1" oninput="updateSummary()">
      </div>
      <div class="form-group">
        <label for="unit_${itemCounter}">หน่วย</label>
        <input type="text" id="unit_${itemCounter}" class="form-control" 
               value="หน่วย" placeholder="เช่น ชิ้น, ชุด, เมตร">
      </div>
      <div class="form-group">
        <label for="price_${itemCounter}">ราคาต่อหน่วย</label>
        <input type="number" id="price_${itemCounter}" class="form-control" 
               value="0" min="0" step="1" oninput="updateSummary()" 
               placeholder="0">
      </div>
      <div class="form-group">
        <label>รวม</label>
        <input type="text" id="total_${itemCounter}" class="form-control"
               readonly style="background: var(--gray-100); font-weight: 600;">
      </div>
    </div>
  `;

        container.appendChild(itemCard);
        updateSummary();

        // Auto-focus on description field
        setTimeout(() => {
            document.getElementById(`desc_${itemCounter}`).focus();
        }, 100);
    }

    function removeItem(itemId) {
        const itemCards = document.querySelectorAll('.item-card');
        if (itemCards.length <= 1) {
            showAlert('ต้องมีอย่างน้อย 1 รายการ', 'warning');
            return;
        }

        const itemCard = document.getElementById(`item_${itemId}`);
        if (itemCard) {
            itemCard.remove();
            updateSummary();
            renumberItems();
        }
    }

    function renumberItems() {
        const itemCards = document.querySelectorAll('.item-card');
        itemCards.forEach((card, index) => {
            const numberSpan = card.querySelector('.item-number');
            if (numberSpan) {
                numberSpan.textContent = `รายการที่ ${index + 1}`;
            }
        });
    }

    function updateSummary() {
        let totalSum = 0;
        let hasValidItems = false;

        document.querySelectorAll('.item-card').forEach(item => {
            const id = item.id.split('_')[1];
            const desc = document.getElementById(`desc_${id}`)?.value?.trim() || '';
            const qty = parseFloat(document.getElementById(`qty_${id}`)?.value) || 0;
            const price = parseFloat(document.getElementById(`price_${id}`)?.value) || 0;
            const total = qty * price;

            // Update item total
            const totalField = document.getElementById(`total_${id}`);
            if (totalField) {
                totalField.value = formatCurrency(total);
            }

            // ราคา 0 = ของแถม นับเป็นรายการที่ถูกต้อง (BUG-5)
            if (desc && qty > 0) {
                totalSum += total;
                hasValidItems = true;
            }
        });

        // Update summary card
        const summaryCard = document.getElementById('summaryCard');
        const subtotalEl = document.getElementById('subtotal');
        const grandTotalEl = document.getElementById('grandTotal');
        const totalTextEl = document.getElementById('totalText');

        if (hasValidItems && totalSum > 0) {
            summaryCard.style.display = 'block';
            subtotalEl.textContent = formatCurrency(totalSum) + ' บาท';
            grandTotalEl.textContent = formatCurrency(totalSum) + ' บาท';
            if (totalTextEl) totalTextEl.textContent = numberToThaiText(totalSum);
        } else {
            summaryCard.style.display = 'none';
        }

        // Update submit button state
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) {
            submitBtn.disabled = !hasValidItems;
        }

        // อัปเดตแถวมัดจำ/คงเหลือใน summary card
        updateDepositPreviewInSummary(totalSum);
        updateDepositPreview();
    }

    function updateDepositPreviewInSummary(totalSum) {
        const depositRow = document.getElementById('depositRow');
        const remainingRow = document.getElementById('remainingRow');
        if (!depositRow || !remainingRow) return;

        const depositSelect = document.getElementById('depositSelect');
        let pct = depositSelect ? depositSelect.value : '';
        if (pct === 'custom') pct = parseFloat(document.getElementById('depositCustom')?.value) || 0;
        const dep = (pct && totalSum > 0) ? computeDeposit(totalSum, pct) : null;

        if (dep) {
            depositRow.style.display = 'flex';
            remainingRow.style.display = 'flex';
            document.getElementById('depositLabel').textContent = 'เงินมัดจำ (' + dep.percent + '%)';
            document.getElementById('depositVal').textContent = formatCurrency(dep.deposit) + ' บาท';
            document.getElementById('remainingVal').textContent = formatCurrency(dep.remaining) + ' บาท';
        } else {
            depositRow.style.display = 'none';
            remainingRow.style.display = 'none';
        }
    }

    function updateSummaryCard() {
        const selectedType = document.querySelector('input[name="documentType"]:checked').value;
        const summaryCard = document.getElementById('summaryCard');

        if (summaryCard) {
            if (selectedType === 'ใบเสนอราคา') {
                summaryCard.style.background = 'linear-gradient(135deg, var(--purple), var(--orange))';
            } else {
                summaryCard.style.background = 'linear-gradient(135deg, var(--primary-blue), var(--purple))';
            }
        }

        updateSummary();
    }

    // ====================================================================
    // Form Management
    // ====================================================================

    function clearForm() {
        if (!confirm('ต้องการล้างข้อมูลทั้งหมดในฟอร์มใช่หรือไม่?')) {
            return;
        }

        // Clear customer form
        document.getElementById('customerForm').reset();

        // Clear items
        document.getElementById('itemsContainer').innerHTML = '';
        itemCounter = 0;
        addNewItem();

        // Reset document type
        document.querySelector('input[name="documentType"][value="บิลเงินสด"]').checked = true;
        updateDocumentType();

        // Reset extras: หมายเหตุ/มัดจำ/ลายเซ็น
        const noteEl = document.getElementById('documentNote');
        if (noteEl) noteEl.value = '';
        const depositSelect = document.getElementById('depositSelect');
        if (depositSelect) {
            depositSelect.value = '';
            document.getElementById('customDepositGroup').style.display = 'none';
        }
        const depositCustom = document.getElementById('depositCustom');
        if (depositCustom) depositCustom.value = '30';
        const depositPreview = document.getElementById('depositPreview');
        if (depositPreview) { depositPreview.style.display = 'none'; depositPreview.innerHTML = ''; }
        clearCustomerSignature();

        // Set default date
        setDefaultDate();

        // Clear localStorage
        localStorage.removeItem('inandon_form_data');

        updateSummary();
        showAlert('ล้างฟอร์มเรียบร้อยแล้ว', 'success');
    }

    function saveFormToStorage() {
        try {
            const formData = {
                customerType: document.getElementById('customerType')?.value || '',
                customerName: document.getElementById('customerName')?.value || '',
                customerAddress: document.getElementById('customerAddress')?.value || '',
                customerProvince: document.getElementById('customerProvince')?.value || '',
                customerPostalCode: document.getElementById('customerPostalCode')?.value || '',
                customerTaxId: document.getElementById('customerTaxId')?.value || '',
                customerPhone: document.getElementById('customerPhone')?.value || '',
                customerEmail: document.getElementById('customerEmail')?.value || '',
                contactPerson: document.getElementById('contactPerson')?.value || '',
                timestamp: Date.now()
            };

            localStorage.setItem('inandon_form_data', JSON.stringify(formData));
        } catch (error) {
            console.warn('Cannot save form to storage:', error);
        }
    }

    function loadFormFromStorage() {
        try {
            const saved = localStorage.getItem('inandon_form_data');
            if (saved) {
                const formData = JSON.parse(saved);

                // Only load if saved within last 24 hours
                if (Date.now() - formData.timestamp < 24 * 60 * 60 * 1000) {
                    Object.keys(formData).forEach(key => {
                        if (key !== 'timestamp') {
                            const element = document.getElementById(key);
                            if (element) {
                                element.value = formData[key];
                            }
                        }
                    });
                }
            }
        } catch (error) {
            console.warn('Cannot load form from storage:', error);
        }
    }

    function loadLastDocument() {
        showLoading('กำลังโหลดเอกสารล่าสุด...');

        google.script.run
            .withSuccessHandler(handleEditDocumentSuccess)
            .withFailureHandler(handleEditDocumentError)
            .getLatestDocumentForEdit();
    }

    // ฟังก์ชันเก่าถูกแทนที่ด้วย handleEditDocumentSuccess แล้ว

    // ====================================================================
    // Customer Management
    // ====================================================================

    function openCustomerModal() {
        showModal('customerModal');
        loadModalCustomers();
    }

    function loadModalCustomers() {
        const list = document.getElementById('modalCustomerList');
        list.innerHTML = '<div class="text-center" style="padding: 40px;"><div class="spinner"></div><p>กำลังโหลดข้อมูลลูกค้า...</p></div>';

        google.script.run
            .withSuccessHandler(handleCustomersSuccess)
            .withFailureHandler(handleCustomersError)
            .getAllCustomers();
    }

    function handleCustomersSuccess(customers) {
        console.log('📋 Received customers data:', customers);
        if (!customers || !Array.isArray(customers)) {
            console.error('❌ Invalid customers data received:', customers);
            handleCustomersError(new Error('Invalid data format'));
            return;
        }
        currentCustomers = customers;
        displayModalCustomers(customers);
    }

    function handleCustomersError(error) {
        const list = document.getElementById('modalCustomerList');
        list.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon"><i class="ti ti-alert-triangle"></i></span>
      <p>ไม่สามารถโหลดข้อมูลลูกค้าได้</p>
      <button class="btn btn-primary" onclick="loadModalCustomers()">ลองใหม่</button>
    </div>
  `;
    }

    function displayModalCustomers(customers) {
        console.log('🎭 Displaying modal customers:', customers);
        const list = document.getElementById('modalCustomerList');

        if (!customers || customers.length === 0) {
            console.log('📭 No customers to display in modal');
            list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon"><i class="ti ti-users-group"></i></span>
        <p>ยังไม่มีข้อมูลลูกค้า</p>
        <button class="btn btn-primary" onclick="closeModal('customerModal'); addNewCustomer();">เพิ่มลูกค้าใหม่</button>
      </div>
    `;
            return;
        }

        console.log(`🎭 Rendering ${customers.length} customers in modal`);

        list.innerHTML = customers.map(customer => `
    <div class="list-item" onclick="selectCustomer('${escapeHtml(customer.id)}')">
      <div style="font-weight: 600;">${escapeHtml(customer.name)}</div>
      <div style="font-size: 14px; color: var(--gray-500);">${escapeHtml(customer.address)}</div>
      <div style="font-size: 12px; color: var(--gray-500);">
        ${customer.phone ? 'โทร: ' + escapeHtml(customer.phone) : ''}
        ${customer.taxId ? ' | เลขภาษี: ' + escapeHtml(customer.taxId) : ''}
      </div>
    </div>
  `).join('');
    }

    function searchModalCustomers() {
        const searchTerm = document.getElementById('modalCustomerSearch').value.toLowerCase().trim();

        if (!searchTerm) {
            displayModalCustomers(currentCustomers);
            return;
        }

        const filtered = currentCustomers.filter(customer =>
            (customer.name && customer.name.toLowerCase().includes(searchTerm)) ||
            (customer.phone && customer.phone.includes(searchTerm)) ||
            (customer.taxId && customer.taxId.includes(searchTerm)) ||
            (customer.address && customer.address.toLowerCase().includes(searchTerm))
        );

        displayModalCustomers(filtered);
    }

    function selectCustomer(customerId) {
        const customer = currentCustomers.find(c => c.id === customerId);
        if (customer) {
            fillCustomerForm(customer);
            closeModal('customerModal');
            showAlert('เลือกลูกค้าเรียบร้อยแล้ว', 'success');
        }
    }

    function fillCustomerForm(customer) {
        console.log('📝 Filling customer form with:', customer);
        document.getElementById('customerType').value = customer.type || 'บุคคล';
        document.getElementById('customerName').value = customer.name || '';
        document.getElementById('customerAddress').value = customer.address || '';
        document.getElementById('customerTaxId').value = customer.taxId || '';
        document.getElementById('customerPhone').value = customer.phone || '';

        // Fill additional fields if available
        document.getElementById('customerProvince').value = customer.province || '';
        document.getElementById('customerPostalCode').value = customer.postalCode || '';
        document.getElementById('customerEmail').value = customer.email || '';
        document.getElementById('contactPerson').value = customer.contactPerson || '';
    }

    // ====================================================================
    // Document Submission
    // ====================================================================

    function submitDocument() {
        if (isLoading) return;

        if (!validateForm()) {
            return;
        }

        const customerData = getCustomerData();
        const itemsData = getItemsData();
        const documentType = document.querySelector('input[name="documentType"]:checked').value;
        const documentDate = document.getElementById('documentDate').value;
        const validUntil = document.getElementById('validUntil').value;

        if (itemsData.length === 0) {
            showAlert('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'warning');
            return;
        }

        showLoading(`กำลังสร้าง${documentType}...`);

        const extraOptions = getExtraOptions();
        google.script.run
            .withSuccessHandler(handleDocumentSuccess)
            .withFailureHandler(handleDocumentError)
            .createBillWithCorrectTemplate(customerData, itemsData, documentDate, documentType,
                documentType === 'ใบเสนอราคา' ? validUntil : null, extraOptions);
    }

    // ====================================================================
    // Signature Pad (ลายเซ็นลูกค้า — canvas รองรับนิ้ว/ปากกา)
    // ====================================================================

    let customerSignatureDataUrl = '';
    let sigCanvasReady = false;

    function initSignaturePad() {
        const canvas = document.getElementById('sigCanvas');
        if (!canvas || sigCanvasReady) return;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        let drawing = false;
        const pos = (e) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (canvas.width / rect.width),
                y: (e.clientY - rect.top) * (canvas.height / rect.height)
            };
        };

        canvas.addEventListener('pointerdown', e => {
            drawing = true;
            canvas.setPointerCapture(e.pointerId);
            const p = pos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            e.preventDefault();
        });
        canvas.addEventListener('pointermove', e => {
            if (!drawing) return;
            const p = pos(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            e.preventDefault();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
            canvas.addEventListener(ev, () => { drawing = false; }));

        sigCanvasReady = true;
    }

    function openSignaturePad() {
        showModal('signatureModal');
        initSignaturePad();
        // focus trap เบื้องต้น — ป้องกัน scroll หน้าหลัง
        document.body.style.overflow = 'hidden';
    }

    function closeSignaturePad() {
        closeModal('signatureModal');
    }

    function clearSignatureCanvas() {
        const canvas = document.getElementById('sigCanvas');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function saveSignatureFromCanvas() {
        const canvas = document.getElementById('sigCanvas');
        // เช็คว่ามีการวาดจริง (พิกเซลที่ไม่ใช่ขาว)
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let drawn = false;
        for (let i = 0; i < data.length; i += 40) {
            if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) { drawn = true; break; }
        }
        if (!drawn) {
            showAlert('กรุณาวาดลายเซ็นก่อน', 'warning');
            return;
        }
        customerSignatureDataUrl = canvas.toDataURL('image/png');
        const preview = document.getElementById('sigPreview');
        preview.src = customerSignatureDataUrl;
        preview.style.display = 'block';
        document.getElementById('clearSigBtn').style.display = 'inline-flex';
        closeSignaturePad();
        showAlert('บันทึกลายเซ็นลูกค้าแล้ว จะแนบไปกับเอกสารถัดไป', 'success');
    }

    function clearCustomerSignature() {
        customerSignatureDataUrl = '';
        const preview = document.getElementById('sigPreview');
        preview.style.display = 'none';
        preview.src = '';
        document.getElementById('clearSigBtn').style.display = 'none';
    }

    // โหลดค่า config สาธารณะ (ลายเซ็นร้านพร้อมใช้หรือไม่)
    function loadPublicConfig() {
        google.script.run
            .withSuccessHandler(config => {
                const toggle = document.getElementById('shopSignatureToggle');
                if (!toggle) return;
                if (!config || !config.hasShopSignature) {
                    toggle.checked = false;
                    toggle.disabled = true;
                    toggle.parentNode.title = 'ยังไม่ได้ตั้งค่าลายเซ็นร้าน — รัน bootstrapShopSignature ก่อน';
                } else {
                    toggle.checked = config.signatureEnabled !== false;
                    // preview ลายเซ็นร้านในฟอร์ม
                    if (config.signatureUrl) {
                        const preview = document.getElementById('shopSigPreview');
                        if (preview) {
                            preview.src = config.signatureUrl;
                            preview.style.display = 'block';
                        }
                    }
                }
            })
            .withFailureHandler(() => { /* ใช้ค่า default ได้ */ })
            .getPublicConfig();
    }

    // ====================================================================
    // Role Switch (สลับหัวเอกสารจากประวัติ — ไม่ต้องกรอกใหม่)
    // ====================================================================

    let roleSwitchTarget = null;
    const BILL_ROLES = ['บิลเงินสด', 'ใบวางบิล', 'ใบเสร็จรับเงิน'];

    function openRoleModal(billNumber, currentType) {
        roleSwitchTarget = { number: billNumber, type: currentType };
        document.getElementById('roleModalDoc').textContent =
            'เลขที่ ' + billNumber + ' (ปัจจุบัน: ' + currentType + ') — เลขเดิม ออก PDF ใหม่';
        const selector = document.getElementById('roleSelector');
        selector.innerHTML = BILL_ROLES.map(role => {
            const disabled = role === currentType ? 'disabled style="opacity:0.4;pointer-events:none;"' : '';
            return `<button type="button" class="btn-action blue" ${disabled} onclick="confirmRoleSwitch('${role}')">
                        <span class="action-icon"><i class="ti ti-file-invoice"></i></span><span>${role}</span>
                    </button>`;
        }).join('');
        showModal('roleModal');
    }

    function confirmRoleSwitch(newRole) {
        if (!roleSwitchTarget) return;
        closeModal('roleModal');
        showLoading('กำลังออกเอกสารหัวใหม่...');
        google.script.run
            .withSuccessHandler(handleDocumentSuccess)
            .withFailureHandler(handleDocumentError)
            .regenerateDocument(roleSwitchTarget.number, newRole, {});
    }

    function getCustomerData() {
        return {
            type: document.getElementById('customerType').value,
            name: document.getElementById('customerName').value.trim(),
            address: document.getElementById('customerAddress').value.trim(),
            province: document.getElementById('customerProvince').value.trim(),
            postalCode: document.getElementById('customerPostalCode').value.trim(),
            taxId: document.getElementById('customerTaxId').value.trim(),
            phone: document.getElementById('customerPhone').value.trim(),
            email: document.getElementById('customerEmail').value.trim(),
            contactPerson: document.getElementById('contactPerson').value.trim()
        };
    }

    function getItemsData() {
        const items = [];

        document.querySelectorAll('.item-card').forEach(item => {
            const id = item.id.split('_')[1];
            const description = document.getElementById(`desc_${id}`)?.value?.trim();
            const quantity = parseFloat(document.getElementById(`qty_${id}`)?.value) || 0;
            const unit = document.getElementById(`unit_${id}`)?.value?.trim() || 'หน่วย';
            const price = parseFloat(document.getElementById(`price_${id}`)?.value) || 0;

            // ราคา 0 = ของแถม ส่งเข้าเอกสารได้ (BUG-5)
            if (description && quantity > 0) {
                items.push({
                    description,
                    quantity,
                    unit,
                    price
                });
            }
        });

        return items;
    }

    function handleDocumentSuccess(result) {
        hideLoading();

        if (result.success) {
            showSuccessModal(result);

            // Clear form after successful submission
            setTimeout(() => {
                clearForm();
            }, 1000);
        } else {
            showError(result.error || 'เกิดข้อผิดพลาดในการสร้างเอกสาร');
        }
    }

    function handleDocumentError(error) {
        hideLoading();
        showError('เกิดข้อผิดพลาดในการสร้างเอกสาร: ' + error.message);
    }

    function showSuccessModal(result) {
        // backend ส่ง billNumber กลับมาเสมอ — รองรับทั้งสองเลข (BUG-8)
        const numberField = result.billNumber || result.quotationNumber || '-';

        document.getElementById('documentNumber').textContent = numberField;
        document.getElementById('documentAmount').textContent = formatCurrency(result.totalAmount) + ' บาท';

        // PDF ล้มเหลว = ปิดปุ่ม ไม่ให้ href="" พากลับมาหน้าเดิม (BUG-15)
        const viewBtn = document.getElementById('viewPdfBtn');
        const dlBtn = document.getElementById('downloadPdfBtn');
        const hasPdf = !!result.pdfViewUrl;
        viewBtn.href = result.pdfViewUrl || '#';
        dlBtn.href = result.pdfDownloadUrl || '#';
        viewBtn.style.opacity = hasPdf ? '1' : '0.5';
        dlBtn.style.opacity = hasPdf ? '1' : '0.5';
        viewBtn.style.pointerEvents = hasPdf ? '' : 'none';
        dlBtn.style.pointerEvents = hasPdf ? '' : 'none';

        showModal('successModal');
    }

    function closeSuccessModal() {
        closeModal('successModal');
    }

    // ====================================================================
    // History Management
    // ====================================================================

    function loadHistoryData() {
        const container = document.getElementById('historyList');
        container.innerHTML = `
    <div class="text-center" style="padding: 40px;">
      <div class="spinner"></div>
      <p>กำลังโหลดประวัติ...</p>
    </div>
  `;

        google.script.run
            .withSuccessHandler(handleHistorySuccess)
            .withFailureHandler(handleHistoryError)
            .getCombinedHistory(50);
    }

    function handleHistorySuccess(history) {
        console.log('📜 Received history data:', history);
        if (!history || !Array.isArray(history)) {
            console.error('❌ Invalid history data received:', history);
            handleHistoryError(new Error('Invalid data format'));
            return;
        }
        currentHistory = history;
        displayHistory(history);
    }

    function handleHistoryError(error) {
        const container = document.getElementById('historyList');
        container.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon"><i class="ti ti-alert-triangle"></i></span>
      <p>ไม่สามารถโหลดประวัติได้</p>
      <button class="btn btn-primary" onclick="loadHistoryData()">ลองใหม่</button>
    </div>
  `;
    }

    function displayHistory(history) {
        const container = document.getElementById('historyList');

        if (!history || history.length === 0) {
            container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon"><i class="ti ti-folder-off"></i></span>
        <p>ยังไม่มีประวัติเอกสาร</p>
      </div>
    `;
            return;
        }

        container.innerHTML = history.map(item => {
            const isQuotation = item.type === 'quotation';
            const typeClass = isQuotation ? 'quotation' : 'bill';
            const typeText = item.currentType || (isQuotation ? 'ใบเสนอราคา' : 'บิลเงินสด');

            return `
      <div class="history-item">
        <div class="history-item-header">
          <div class="history-item-info">
            <div class="history-item-number">
              ${escapeHtml(item.displayNumber)}
              <span class="history-item-type ${typeClass}">${typeText}</span>
            </div>
            <div class="history-item-details">
              <div class="history-item-detail">
                <div class="history-item-label">ลูกค้า</div>
                <div class="history-item-value">${escapeHtml(item.customerName)}</div>
              </div>
              <div class="history-item-detail">
                <div class="history-item-label">วันที่</div>
                <div class="history-item-value">${item.date}</div>
              </div>
              <div class="history-item-detail">
                <div class="history-item-label">ยอดเงิน</div>
                <div class="history-item-value">${formatCurrency(item.grandTotal)} บาท</div>
              </div>
            </div>
          </div>
        </div>
        <div class="history-item-actions">
          <a href="${escapeHtml(item.pdfViewUrl || '#')}" target="_blank" class="btn btn-sm btn-primary" ${item.pdfViewUrl ? '' : 'style="opacity:0.5;pointer-events:none;"'}>
            <i class="ti ti-eye"></i> ดู
          </a>
          <a href="${escapeHtml(item.pdfDownloadUrl || '#')}" target="_blank" class="btn btn-sm btn-secondary" ${item.pdfDownloadUrl ? '' : 'style="opacity:0.5;pointer-events:none;"'}>
            <i class="ti ti-download"></i> ดาวน์โหลด
          </a>
          <button class="btn btn-sm btn-outline" onclick="editDocument('${escapeHtml(item.type)}', '${escapeHtml(item.billNumber || item.quotationNumber)}')">
            <i class="ti ti-pencil"></i> แก้ไข
          </button>
          ${item.type === 'bill' ? `<button class="btn btn-sm btn-outline" onclick="openRoleModal('${escapeHtml(item.billNumber)}', '${escapeHtml(item.currentType || 'บิลเงินสด')}')">
            <i class="ti ti-refresh-dot"></i> สลับหัว
          </button>` : ''}
        </div>
      </div>
    `;
        }).join('');
    }

    function searchHistory() {
        const searchTerm = document.getElementById('historySearch').value.toLowerCase().trim();
        const filterType = document.getElementById('historyFilter').value;

        let filtered = currentHistory;

        // Filter by type
        if (filterType !== 'all') {
            filtered = filtered.filter(item => item.type === filterType);
        }

        // Filter by search term
        if (searchTerm) {
            filtered = filtered.filter(item =>
                (item.customerName && item.customerName.toLowerCase().includes(searchTerm)) ||
                (item.displayNumber && item.displayNumber.toLowerCase().includes(searchTerm)) ||
                (item.date && item.date.includes(searchTerm))
            );
        }

        displayHistory(filtered);
    }

    function filterHistory() {
        searchHistory(); // Same logic as search
    }

    // ====================================================================
    // Customer List Management
    // ====================================================================

    function loadCustomersData() {
        const container = document.getElementById('customersList');
        container.innerHTML = `
    <div class="text-center" style="padding: 40px;">
      <div class="spinner"></div>
      <p>กำลังโหลดข้อมูลลูกค้า...</p>
    </div>
  `;

        google.script.run
            .withSuccessHandler(handleCustomersListSuccess)
            .withFailureHandler(handleCustomersListError)
            .getAllCustomers();
    }

    function handleCustomersListSuccess(customers) {
        console.log('👥 Received customers list data:', customers);
        if (!customers || !Array.isArray(customers)) {
            console.error('❌ Invalid customers list data received:', customers);
            handleCustomersListError(new Error('Invalid data format'));
            return;
        }
        currentCustomers = customers;
        displayCustomersList(customers);
    }

    function handleCustomersListError(error) {
        const container = document.getElementById('customersList');
        container.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon"><i class="ti ti-alert-triangle"></i></span>
      <p>ไม่สามารถโหลดข้อมูลลูกค้าได้</p>
      <button class="btn btn-primary" onclick="loadCustomersData()">ลองใหม่</button>
    </div>
  `;
    }

    function displayCustomersList(customers) {
        console.log('🎨 Displaying customers list:', customers);
        const container = document.getElementById('customersList');

        if (!customers || customers.length === 0) {
            console.log('📭 No customers to display');
            container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon"><i class="ti ti-users-group"></i></span>
        <p>ยังไม่มีข้อมูลลูกค้า</p>
        <button class="btn btn-primary" onclick="addNewCustomer()">เพิ่มลูกค้าใหม่</button>
      </div>
    `;
            return;
        }

        console.log(`👥 Rendering ${customers.length} customers`);

        container.innerHTML = customers.map(customer => `
    <div class="list-item">
      <div class="list-item-header">
        <div class="list-item-title">${escapeHtml(customer.name)}</div>
        <div class="list-item-meta">${escapeHtml(customer.type || 'บุคคล')}</div>
      </div>
      <div class="list-item-meta">
        <strong>ที่อยู่:</strong> ${escapeHtml(customer.address || '-')}<br>
        <strong>โทร:</strong> ${escapeHtml(customer.phone || '-')} |
        <strong>เลขผู้เสียภาษี:</strong> ${escapeHtml(customer.taxId || '-')}
      </div>
      <div style="margin-top: 12px;">
        <button class="btn btn-sm btn-primary" onclick="useCustomerForNewDocument('${escapeHtml(customer.id)}')">
          <i class="ti ti-file-pencil"></i> สร้างเอกสาร
        </button>
        <button class="btn btn-sm btn-outline" onclick="editCustomer('${escapeHtml(customer.id)}')">
          <i class="ti ti-pencil"></i> แก้ไข
        </button>
      </div>
    </div>
  `).join('');
    }

    function searchCustomerList() {
        const searchTerm = document.getElementById('customerSearch').value.toLowerCase().trim();

        if (!searchTerm) {
            displayCustomersList(currentCustomers);
            return;
        }

        const filtered = currentCustomers.filter(customer =>
            (customer.name && customer.name.toLowerCase().includes(searchTerm)) ||
            (customer.phone && customer.phone.includes(searchTerm)) ||
            (customer.taxId && customer.taxId.includes(searchTerm)) ||
            (customer.address && customer.address.toLowerCase().includes(searchTerm))
        );

        displayCustomersList(filtered);
    }

    function useCustomerForNewDocument(customerId) {
        console.log('🔍 Looking for customer ID:', customerId);
        console.log('📝 Available customers:', currentCustomers);

        const customer = currentCustomers.find(c => c.id === customerId);
        if (customer) {
            console.log('✅ Found customer:', customer);
            switchTab('create');
            fillCustomerForm(customer);
            showAlert('ข้อมูลลูกค้าถูกโหลดแล้ว กรุณาเพิ่มรายการสินค้า', 'success');
        } else {
            console.error('❌ Customer not found with ID:', customerId);
            showAlert('ไม่พบข้อมูลลูกค้า กรุณาลองใหม่', 'error');
        }
    }

    function addNewCustomer() {
        showModal('addCustomerModal');
        clearCustomerForm();
    }

    function editCustomer(customerId) {
        const customer = currentCustomers.find(c => c.id === customerId);
        if (customer) {
            showModal('addCustomerModal');
            fillCustomerFormModal(customer);
            document.getElementById('customerModalTitle').textContent = 'แก้ไขข้อมูลลูกค้า';
            document.getElementById('modalCustomerId').value = customer.id;
        }
    }

    function fillCustomerFormModal(customer) {
        document.getElementById('modalCustomerType').value = customer.type || 'บุคคล';
        document.getElementById('modalCustomerName').value = customer.name || '';
        document.getElementById('modalCustomerAddress').value = customer.address || '';
        document.getElementById('modalCustomerProvince').value = customer.province || '';
        document.getElementById('modalCustomerPostalCode').value = customer.postalCode || '';
        document.getElementById('modalCustomerTaxId').value = customer.taxId || '';
        document.getElementById('modalCustomerPhone').value = customer.phone || '';
        document.getElementById('modalCustomerEmail').value = customer.email || '';
        document.getElementById('modalContactPerson').value = customer.contactPerson || '';
    }

    function clearCustomerForm() {
        document.getElementById('customerModalTitle').textContent = 'เพิ่มลูกค้าใหม่';
        document.getElementById('modalCustomerId').value = '';
        document.getElementById('modalCustomerType').value = 'บุคคล';
        document.getElementById('modalCustomerName').value = '';
        document.getElementById('modalCustomerAddress').value = '';
        document.getElementById('modalCustomerProvince').value = '';
        document.getElementById('modalCustomerPostalCode').value = '';
        document.getElementById('modalCustomerTaxId').value = '';
        document.getElementById('modalCustomerPhone').value = '';
        document.getElementById('modalCustomerEmail').value = '';
        document.getElementById('modalContactPerson').value = '';
    }

    function saveCustomer() {
        const customerData = {
            id: document.getElementById('modalCustomerId').value,
            type: document.getElementById('modalCustomerType').value,
            name: document.getElementById('modalCustomerName').value.trim(),
            address: document.getElementById('modalCustomerAddress').value.trim(),
            province: document.getElementById('modalCustomerProvince').value.trim(),
            postalCode: document.getElementById('modalCustomerPostalCode').value.trim(),
            taxId: document.getElementById('modalCustomerTaxId').value.trim(),
            phone: document.getElementById('modalCustomerPhone').value.trim(),
            email: document.getElementById('modalCustomerEmail').value.trim(),
            contactPerson: document.getElementById('modalContactPerson').value.trim()
        };

        if (!customerData.name) {
            showAlert('กรุณากรอกชื่อลูกค้า', 'warning');
            return;
        }

        if (!customerData.address) {
            showAlert('กรุณากรอกที่อยู่', 'warning');
            return;
        }

        showLoading('กำลังบันทึกข้อมูลลูกค้า...');

        if (customerData.id) {
            // แก้ไขลูกค้าเดิม
            google.script.run
                .withSuccessHandler(handleSaveCustomerSuccess)
                .withFailureHandler(handleSaveCustomerError)
                .updateCustomer(customerData);
        } else {
            // เพิ่มลูกค้าใหม่
            google.script.run
                .withSuccessHandler(handleSaveCustomerSuccess)
                .withFailureHandler(handleSaveCustomerError)
                .addCustomer(customerData);
        }
    }

    function handleSaveCustomerSuccess(result) {
        hideLoading();
        if (result.success) {
            closeModal('addCustomerModal');
            showAlert('บันทึกข้อมูลลูกค้าเรียบร้อยแล้ว', 'success');

            // Refresh customer lists everywhere
            loadCustomersData(); // Always refresh main customer list

            // Clear and reload modal customer data
            currentCustomers = [];
            const modalList = document.getElementById('modalCustomerList');
            if (modalList) {
                modalList.innerHTML = '<div class="text-center" style="padding: 40px;"><div class="spinner"></div><p>กำลังโหลดข้อมูลลูกค้า...</p></div>';
            }

            // Reload modal customers with delay to ensure data is fresh
            setTimeout(() => {
                loadModalCustomers();
            }, 500);

        } else {
            showAlert('เกิดข้อผิดพลาด: ' + result.message, 'error');
        }
    }

    function handleSaveCustomerError(error) {
        hideLoading();
        showAlert('ไม่สามารถบันทึกข้อมูลลูกค้าได้: ' + error.message, 'error');
    }

    // ====================================================================
    // Document Editing Functions
    // ====================================================================

    function editDocument(documentType, documentNumber) {
        showLoading('กำลังโหลดข้อมูลเอกสาร...');

        if (documentType === 'bill') {
            google.script.run
                .withSuccessHandler(handleEditDocumentSuccess)
                .withFailureHandler(handleEditDocumentError)
                .getBillForEdit(documentNumber);
        } else if (documentType === 'quotation') {
            google.script.run
                .withSuccessHandler(handleEditDocumentSuccess)
                .withFailureHandler(handleEditDocumentError)
                .getQuotationForEdit(documentNumber);
        }
    }

    function handleEditDocumentSuccess(documentData) {
        hideLoading();

        if (documentData.success) {
            // Switch to create tab
            switchTab('create');

            // Fill form with document data
            fillFormWithDocumentData(documentData.data);

            // Show success message
            showAlert('โหลดข้อมูลเอกสารเรียบร้อยแล้ว กรุณาแก้ไขและกดสร้างใหม่', 'info');

            // Scroll to top
            window.scrollTo(0, 0);

        } else {
            showAlert('ไม่สามารถโหลดข้อมูลเอกสารได้: ' + documentData.message, 'error');
        }
    }

    function handleEditDocumentError(error) {
        hideLoading();
        showAlert('เกิดข้อผิดพลาดในการโหลดเอกสาร: ' + error.message, 'error');
    }

    function fillFormWithDocumentData(data) {
        console.log('📝 Filling form with document data:', data);

        // Fill customer data - now includes complete customer info from Customers table
        if (data.customer) {
            document.getElementById('customerType').value = data.customer.type || 'บุคคล';
            document.getElementById('customerName').value = data.customer.name || '';
            document.getElementById('customerAddress').value = data.customer.address || '';
            document.getElementById('customerProvince').value = data.customer.province || '';
            document.getElementById('customerPostalCode').value = data.customer.postalCode || '';
            document.getElementById('customerTaxId').value = data.customer.taxId || '';
            document.getElementById('customerPhone').value = data.customer.phone || '';
            document.getElementById('customerEmail').value = data.customer.email || '';
            document.getElementById('contactPerson').value = data.customer.contactPerson || '';
        }

        // Fill document type and date
        if (data.document) {
            const docType = data.document.type || 'บิลเงินสด';
            const radio = document.querySelector(`input[name="documentType"][value="${docType}"]`) ||
                          document.querySelector('input[name="documentType"][value="บิลเงินสด"]');
            radio.checked = true;
            document.getElementById('documentDate').value = data.document.date || '';
            if (docType === 'ใบเสนอราคา' && data.document.validUntil) {
                document.getElementById('validUntil').value = data.document.validUntil;
            }
            // เติมหมายเหตุ + มัดจำ จากเอกสารเดิม
            const noteEl = document.getElementById('documentNote');
            const depositSelect = document.getElementById('depositSelect');
            if (noteEl) noteEl.value = data.document.note || '';
            if (depositSelect) {
                const pct = data.document.depositPercent ? String(data.document.depositPercent) : '';
                if (pct === '30' || pct === '50') {
                    depositSelect.value = pct;
                    document.getElementById('customDepositGroup').style.display = 'none';
                } else if (pct) {
                    depositSelect.value = 'custom';
                    document.getElementById('customDepositGroup').style.display = 'block';
                    document.getElementById('depositCustom').value = pct;
                } else {
                    depositSelect.value = '';
                    document.getElementById('customDepositGroup').style.display = 'none';
                }
            }
            updateDocumentType();
        }

        // Clear existing items
        const itemsContainer = document.getElementById('itemsContainer');
        if (itemsContainer) {
            itemsContainer.innerHTML = '';
        }
        itemCounter = 0;

        // Fill items - now supports all items from the same bill_number
        if (data.items && data.items.length > 0) {
            data.items.forEach(item => {
                addNewItem();
                const currentId = itemCounter;

                // Fill item fields
                const descField = document.getElementById(`desc_${currentId}`);
                const qtyField = document.getElementById(`qty_${currentId}`);
                const unitField = document.getElementById(`unit_${currentId}`);
                const priceField = document.getElementById(`price_${currentId}`);

                if (descField) descField.value = item.description || '';
                if (qtyField) qtyField.value = item.quantity || '';
                if (unitField) unitField.value = item.unit || 'หน่วย';
                if (priceField) priceField.value = item.price || '';
            });
        } else {
            // Add at least one empty item
            addNewItem();
        }

        // Update summary with new data
        updateSummary();
    }

    // ====================================================================
    // Utility Functions
    // ====================================================================

    // Escape ข้อความก่อนยัด innerHTML ทุกครั้ง — กัน HTML injection จากชื่อ/ที่อยู่ (BUG-13)
    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatCurrency(amount) {
        return new Intl.NumberFormat('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    }

    // แปลงตัวเลขเป็นคำไทยแบบเต็ม — เหมือน backend เพื่อให้การแสดงผลตรงกับเอกสาร (BUG-16)
    function numberToThaiText(number) {
        if (!number || number === 0) return 'ศูนย์บาทถ้วน';

        const baht = Math.floor(number);
        const satang = Math.round((number - baht) * 100);

        let result = convertToThaiWords(baht) + 'บาท';

        if (satang > 0) {
            result += convertToThaiWords(satang) + 'สตางค์';
        } else {
            result += 'ถ้วน';
        }

        return result;
    }

    function convertToThaiWords(num) {
        const thaiNumbers = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
        const thaiUnits = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

        if (num === 0) return '';

        let result = '';
        let remaining = Math.floor(num);
        let groupIndex = 0;

        while (remaining > 0) {
            const group = remaining % 1000000;
            if (group > 0) {
                let groupText = '';
                const digits = String(group).split('').reverse();

                digits.forEach((digitChar, i) => {
                    const digit = parseInt(digitChar, 10);
                    if (digit === 0) return;
                    if (i === 1 && digit === 2) {
                        groupText = 'ยี่' + thaiUnits[i] + groupText;
                    } else if (i === 1 && digit === 1) {
                        groupText = thaiUnits[i] + groupText;
                    } else if (i === 0 && digit === 1 && digits.length > 1) {
                        groupText = 'เอ็ด' + groupText;
                    } else {
                        groupText = thaiNumbers[digit] + thaiUnits[i] + groupText;
                    }
                });

                result = groupText + (groupIndex > 0 ? 'ล้าน' : '') + result;
            }
            remaining = Math.floor(remaining / 1000000);
            groupIndex++;
        }

        return result;
    }

    function validateForm() {
        const customerName = document.getElementById('customerName').value.trim();
        const customerAddress = document.getElementById('customerAddress').value.trim();

        if (!customerName) {
            showAlert('กรุณากรอกชื่อลูกค้า', 'warning');
            document.getElementById('customerName').focus();
            return false;
        }

        if (!customerAddress) {
            showAlert('กรุณากรอกที่อยู่ลูกค้า', 'warning');
            document.getElementById('customerAddress').focus();
            return false;
        }

        // Validate items
        const items = getItemsData();
        if (items.length === 0) {
            showAlert('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'warning');
            return false;
        }

        return true;
    }

    function validateField(event) {
        const field = event.target;
        const value = field.value.trim();

        if (field.hasAttribute('required') && !value) {
            field.classList.add('error');
            showFieldError(field, 'กรุณากรอกข้อมูลนี้');
        } else {
            field.classList.remove('error');
            clearFieldError(field);
        }
    }

    function clearFieldError(event) {
        const field = event.target;
        field.classList.remove('error');

        const errorMsg = field.parentNode.querySelector('.error-message');
        if (errorMsg) {
            errorMsg.remove();
        }
    }

    function showFieldError(field, message) {
        clearFieldError({ target: field });

        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.style.color = 'var(--danger)';
        errorDiv.style.fontSize = '12px';
        errorDiv.style.marginTop = '4px';
        errorDiv.textContent = message;

        field.parentNode.appendChild(errorDiv);
    }

    // ====================================================================
    // Modal Management
    // ====================================================================

    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            // focus ตัวแรกที่พิมพ์ได้ เพื่อคีย์บอร์ด/สวิตช์
            const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea, button.btn-primary');
            if (firstInput) setTimeout(() => firstInput.focus(), 150);
        }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    // แตะพื้นนอก modal เพื่อปิด (ยกเว้น loading/success ที่ต้องรอ)
    document.addEventListener('click', function (event) {
        if (event.target.classList && event.target.classList.contains('modal')) {
            const id = event.target.id;
            if (id !== 'loadingModal' && id !== 'successModal') {
                closeModal(id);
            }
        }
    });

    function showLoading(message = 'กำลังประมวลผล...') {
        isLoading = true;
        document.getElementById('loadingText').textContent = message;
        showModal('loadingModal');
    }

    function hideLoading() {
        isLoading = false;
        closeModal('loadingModal');
    }

    // ====================================================================
    // Settings & Dark Mode (BUG-4 — เดิมปุ่มเรียกฟังก์ชันที่ไม่มีอยู่)
    // ====================================================================

    function toggleDarkMode() {
        const root = document.documentElement;
        const isDark = root.getAttribute('data-theme') === 'dark';
        root.setAttribute('data-theme', isDark ? 'light' : 'dark');
        try {
            localStorage.setItem('inandon_theme', isDark ? 'light' : 'dark');
        } catch (e) { /* storage อาจถูกปิด */ }
        const icon = document.querySelector('#darkModeBtn .ti');
        if (icon) {
            icon.classList.toggle('ti-sun', !isDark);
            icon.classList.toggle('ti-moon-stars', isDark);
        }
    }

    function applySavedTheme() {
        let theme = null;
        try {
            theme = localStorage.getItem('inandon_theme');
        } catch (e) { /* ignore */ }
        if (theme) {
            document.documentElement.setAttribute('data-theme', theme);
            const icon = document.querySelector('#darkModeBtn .ti');
            if (icon) {
                icon.classList.toggle('ti-sun', theme === 'dark');
                icon.classList.toggle('ti-moon-stars', theme !== 'dark');
            }
        }
    }

    function showSettings() {
        showModal('settingsModal');
        const body = document.getElementById('settingsBody');
        body.innerHTML = '<div class="spinner" style="margin:24px auto;"></div><p class="text-center">กำลังโหลดข้อมูลระบบ...</p>';

        google.script.run
            .withSuccessHandler(info => {
                document.getElementById('settingsBody').innerHTML = `
                    <div class="settings-info">
                        <div class="settings-row"><span>ร้าน</span><strong>${escapeHtml(info.companyName)}</strong></div>
                        <div class="settings-row"><span>เลขบิลถัดไป</span><strong>${escapeHtml(String(info.nextBillNumber))}</strong></div>
                        <div class="settings-row"><span>เลขใบเสนอราคาถัดไป</span><strong>${escapeHtml(String(info.nextQuotationNumber))}</strong></div>
                        <div class="settings-row"><span>ลูกค้าในระบบ</span><strong>${escapeHtml(String(info.customerCount))}</strong></div>
                        <div class="settings-row"><span>เวอร์ชันระบบ</span><strong>${escapeHtml(info.version)}</strong></div>
                    </div>
                `;
            })
            .withFailureHandler(err => {
                document.getElementById('settingsBody').innerHTML =
                    '<p class="text-center" style="color:var(--danger);">โหลดข้อมูลไม่สำเร็จ: ' + escapeHtml(err.message) + '</p>';
            })
            .getSystemInfo();
    }

    // ====================================================================
    // Alert System
    // ====================================================================

    function showAlert(message, type = 'info') {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type}`;
        alertDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 10000;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideInRight 0.3s ease;
  `;

        const colors = {
            success: '#16a34a',
            warning: '#eab308',
            error: '#dc2626',
            info: '#1e40af'
        };

        // เหลืองพื้นเข้ม + ตัวขาว contrast 1.9:1 — ใช้ตัวเข้มบนพื้นเหลืองแทน
        const textColors = {
            warning: '#1f2937'
        };

        alertDiv.style.backgroundColor = colors[type] || colors.info;
        alertDiv.style.color = textColors[type] || 'white';
        alertDiv.textContent = message;

        document.body.appendChild(alertDiv);

        setTimeout(() => {
            alertDiv.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (alertDiv.parentNode) {
                    alertDiv.parentNode.removeChild(alertDiv);
                }
            }, 300);
        }, 4000);
    }

    function showError(message) {
        showAlert(message, 'error');
    }

    // ====================================================================
    // Keyboard Shortcuts
    // ====================================================================

    document.addEventListener('keydown', function (event) {
        // Ctrl/Cmd + S = Save (submit form)
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            if (currentTab === 'create' && !isLoading) {
                submitDocument();
            }
        }

        // Ctrl/Cmd + N = New Item
        if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
            event.preventDefault();
            if (currentTab === 'create') {
                addNewItem();
            }
        }

        // Escape = Close modals
        if (event.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                closeModal(modal.id);
            });
        }
    });

    // ====================================================================
    // CSS Animations
    // ====================================================================

    const style = document.createElement('style');
    style.textContent = `
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOutRight {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
  
  .error {
    border-color: var(--danger) !important;
    box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1) !important;
  }
`;
    document.head.appendChild(style);

    // ====================================================================
    // Service Worker Registration (for PWA)
    // ====================================================================

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            // Register service worker if needed for PWA functionality
            console.log('PWA support available');
        });
    }

    console.log('✅ JavaScript loaded successfully');