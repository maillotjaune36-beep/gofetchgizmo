// Go Fetch, Gizmo! Instant Estimator Client Logic

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const previewGrid = document.getElementById('previewGrid');
    const btnEstimate = document.getElementById('btnEstimate');
    const loadingBox = document.getElementById('loadingBox');
    const quoteResult = document.getElementById('quoteResult');
    const bookingForm = document.getElementById('bookingForm');
    const bookingSuccess = document.getElementById('bookingSuccess');

    let uploadedFiles = [];
    let currentQuoteData = null;

    if (!dropzone || !fileInput) return;

    // Trigger file chooser
    dropzone.addEventListener('click', () => fileInput.click());

    // Drag & Drop
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    function handleFiles(files) {
        const newFiles = Array.from(files).slice(0, 3 - uploadedFiles.length);
        uploadedFiles = [...uploadedFiles, ...newFiles].slice(0, 3);
        renderPreviews();
    }

    function renderPreviews() {
        previewGrid.innerHTML = '';
        if (uploadedFiles.length > 0) {
            btnEstimate.disabled = false;
            btnEstimate.innerText = `Fetch Quote for ${uploadedFiles.length} Photo${uploadedFiles.length > 1 ? 's' : ''} 🐾`;
        } else {
            btnEstimate.disabled = true;
            btnEstimate.innerText = 'Upload Photos to Get Quote';
        }

        uploadedFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'preview-item';

            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            item.appendChild(img);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'preview-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                uploadedFiles.splice(index, 1);
                renderPreviews();
            });
            item.appendChild(removeBtn);

            previewGrid.appendChild(item);
        });
    }

    // Submit for Instant Estimate
    btnEstimate.addEventListener('click', async () => {
        if (uploadedFiles.length === 0) return;

        btnEstimate.style.display = 'none';
        dropzone.style.display = 'none';
        previewGrid.style.display = 'none';
        loadingBox.style.display = 'block';
        quoteResult.style.display = 'none';

        const formData = new FormData();
        uploadedFiles.forEach((file) => {
            formData.append('images', file);
            formData.append('photos', file);
        });

        try {
            const response = await fetch('/api/estimate', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                console.error('Estimate API error details:', errData);
                throw new Error(errData.error || `Estimation failed (${response.status})`);
            }
            const data = await response.json();
            currentQuoteData = data;
            displayQuote(data);
        } catch (err) {
            console.error(err);
            resetEstimator();
            const dropzoneHint = document.querySelector('.dropzone-hint');
            if (dropzoneHint) {
                dropzoneHint.innerHTML = '<span style="color:#FF9A78;font-weight:700">⚠️ Upload error. You can also text photos directly to (916) 546-8537!</span>';
            }
        } finally {
            loadingBox.style.display = 'none';
        }
    });

    function displayQuote(data) {
        quoteResult.style.display = 'block';

        document.getElementById('resTierBadge').innerHTML = `${data.tier_emoji} ${data.tier_name}`;
        document.getElementById('resPriceRange').innerText = `$${data.price_min} - $${data.price_max}`;
        document.getElementById('resStandbyPrice').innerText = `$${data.standby_price_min} - $${data.standby_price_max}`;
        
        // Tags
        const tagsContainer = document.getElementById('resItemsList');
        tagsContainer.innerHTML = '';
        (data.identified_items || []).forEach(item => {
            const tag = document.createElement('span');
            tag.className = 'item-tag';
            tag.innerText = item;
            tagsContainer.appendChild(tag);
        });

        document.getElementById('resGizmoComment').innerText = `"${data.gizmo_comment}"`;
    }

    // Handle 1-Click Booking
    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = bookingForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerText = 'Locking In Slot... 🐾';

        const name = document.getElementById('clientName').value;
        const phone = document.getElementById('clientPhone').value;
        const zip = document.getElementById('clientZip').value;
        const preferredDate = document.getElementById('clientDate').value;
        const standbyOptIn = document.getElementById('standbyCheckbox').checked;

        const payload = {
            name,
            phone,
            zip_code: zip,
            preferred_date: preferredDate,
            standby_opt_in: standbyOptIn,
            estimated_tier: currentQuoteData?.recommended_tier || 'retriever',
            estimated_price_min: currentQuoteData?.price_min || 150,
            estimated_price_max: currentQuoteData?.price_max || 180,
            summary: currentQuoteData?.summary || 'Web photo quote',
            special_notes: currentQuoteData?.special_notes || ''
        };

        try {
            const res = await fetch('/api/book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            bookingForm.style.display = 'none';
            bookingSuccess.style.display = 'block';
        } catch (err) {
            bookingForm.style.display = 'none';
            bookingSuccess.style.display = 'block';
        }
    });

    function resetEstimator() {
        uploadedFiles = [];
        renderPreviews();
        btnEstimate.style.display = 'block';
        dropzone.style.display = 'flex';
        previewGrid.style.display = 'grid';
        loadingBox.style.display = 'none';
        quoteResult.style.display = 'none';
    }
});
