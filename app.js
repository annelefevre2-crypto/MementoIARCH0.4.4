// ======================================================
// Mémento opérationnel IA – RCH
// app.js — Version 0.4.3 (adaptation taille QR dynamique codage jusqu'à au moins 8800 caractères et geolocalisation)
// ------------------------------------------------------
// - Instance unique Html5Qrcode (caméra + fichiers)
// - Lecture de QR JSON → génération des champs variables
// - Concatenation du prompt + infos complémentaires
// - Création du JSON de fiche + QR code
//   * schéma compact
//   * compression DEFLATE + Base64 (pako)
//   * wrapper { z: "pako-base64-v1", d: "<base64>" }
// - Lecture compatible : ancien format, compact, compact+compressé
// - Ajustement de la taille du QR en fonction de la longueur du texte
// ======================================================

let html5QrCode = null;
let isCameraRunning = false;
let currentFiche = null;
let currentVariablesValues = {};

// =============================
// Initialisation
// =============================

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initScanView();
  initCreateView();
});

// Helper : vérifie la présence de la lib Html5Qrcode
function ensureHtml5QrCodeInstance() {
  if (typeof Html5Qrcode === "undefined") {
    throw new Error(
      "La bibliothèque Html5Qrcode n'est pas chargée. Vérifiez le script dans index.html."
    );
  }

  if (!html5QrCode) {
    try {
      const qrConfig = {
        verbose: false,
      };
      html5QrCode = new Html5Qrcode("camera", qrConfig);
    } catch (e) {
      // fallback minimal si la config avancée pose problème
      console.warn(
        "Configuration avancée Html5Qrcode impossible, fallback simple :",
        e
      );
      html5QrCode = new Html5Qrcode("camera");
    }
  }
  return html5QrCode;
}

// =============================
// Onglets
// =============================

function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");

      tabButtons.forEach((b) => b.classList.remove("tab-button--active"));
      btn.classList.add("tab-button--active");

      tabPanels.forEach((panel) => {
        panel.classList.remove("tab-panel--active");
      });
      document
        .getElementById(`tab-${target}`)
        .classList.add("tab-panel--active");
    });
  });
}

// =============================
// Vue Scan / Lecture
// =============================

function initScanView() {
  const cameraBtn = document.getElementById("cameraBtn");
  const resetBtn = document.getElementById("resetBtn");
  const qrFileInput = document.getElementById("qrFile");
  const generatePromptBtn = document.getElementById("generatePromptBtn");
  const infosComplementaires = document.getElementById("infosComplementaires");

  const btnChatgpt = document.getElementById("btnChatgpt");
  const btnPerplexity = document.getElementById("btnPerplexity");
  const btnMistral = document.getElementById("btnMistral");

  cameraBtn.addEventListener("click", startCameraScan);
  resetBtn.addEventListener("click", resetScanView);

  qrFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) scanQrFromFile(file);
  });

  infosComplementaires.addEventListener("input", () =>
    updatePromptPreview(false)
  );

  generatePromptBtn.addEventListener("click", () =>
    updatePromptPreview(true)
  );

  btnChatgpt.addEventListener("click", () => openIa("chatgpt"));
  btnPerplexity.addEventListener("click", () => openIa("perplexity"));
  btnMistral.addEventListener("click", () => openIa("mistral"));
}

// Lance le scan caméra
async function startCameraScan() {
  const cameraError = document.getElementById("cameraError");
  const videoBox = document.getElementById("videoBox");
  const scanHint = document.getElementById("scanHint");

  cameraError.hidden = true;
  cameraError.textContent = "";

  try {
    const qr = ensureHtml5QrCodeInstance();

    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      throw new Error("Aucune caméra disponible");
    }

    // Priorité à une caméra arrière
    let selectedCameraId = cameras[0].id;
    for (const cam of cameras) {
      const label = (cam.label || "").toLowerCase();
      if (
        label.includes("back") ||
        label.includes("arrière") ||
        label.includes("rear")
      ) {
        selectedCameraId = cam.id;
        break;
      }
    }

    const cameraConfig = {
      fps: 10,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        const qrboxSize = Math.floor(minEdge * 0.6);
        return {
          width: qrboxSize,
          height: qrboxSize,
        };
      },
    };

    await qr.start(
      { deviceId: { exact: selectedCameraId } },
      cameraConfig,
      onScanSuccess,
      (errorMessage) => {
        // callback d'erreur de décodage (optionnel)
        console.debug("Erreur de scan en continu (non bloquante) :", errorMessage);
      }
    );

    isCameraRunning = true;
    videoBox.hidden = false;
    scanHint.textContent =
      "Présentez un QR code devant la caméra pour charger la fiche.";
  } catch (err) {
    console.error("Erreur lors de l'activation de la caméra :", err);
    cameraError.textContent =
      "Impossible d'accéder à la caméra : " + (err.message || err);
    cameraError.hidden = false;
  }
}

// Callback en cas de succès de lecture
function onScanSuccess(decodedText) {
  stopCameraScan();
  handleQrDecoded(decodedText);
}

// Arrête le scan caméra
function stopCameraScan() {
  if (isCameraRunning && html5QrCode) {
    html5QrCode
      .stop()
      .then(() => {
        isCameraRunning = false;
      })
      .catch((err) => {
        console.warn("Erreur lors de l'arrêt de la caméra :", err);
      });
  }
}

// Réinitialisation vue scan
function resetScanView() {
  stopCameraScan();
  const videoBox = document.getElementById("videoBox");
  const scanHint = document.getElementById("scanHint");
  const ficheMeta = document.getElementById("ficheMeta");
  const variablesContainer = document.getElementById("variablesContainer");
  const compiledPrompt = document.getElementById("compiledPrompt");
  const infosComplementaires = document.getElementById("infosComplementaires");

  videoBox.hidden = true;
  scanHint.textContent =
    "Scannez un QR code pour charger une fiche opérationnelle.";
  ficheMeta.innerHTML = "Aucune fiche scannée";
  ficheMeta.classList.add("fiche-meta--empty");
  variablesContainer.innerHTML = "";
  compiledPrompt.value = "";
  infosComplementaires.value = "";

  currentFiche = null;
  currentVariablesValues = {};

  setIaButtonsEnabled(false);
}

// Active/désactive les boutons IA
function setIaButtonsEnabled(enabled) {
  const btnChatgpt = document.getElementById("btnChatgpt");
  const btnPerplexity = document.getElementById("btnPerplexity");
  const btnMistral = document.getElementById("btnMistral");

  [btnChatgpt, btnPerplexity, btnMistral].forEach((btn) => {
    btn.disabled = !enabled;
  });
}

// Lecture d'un fichier image de QR code
function scanQrFromFile(file) {
  const cameraError = document.getElementById("cameraError");
  cameraError.hidden = true;
  cameraError.textContent = "";

  try {
    const qr = ensureHtml5QrCodeInstance();
    Html5Qrcode.getCameras()
      .then(() => {
        if (isCameraRunning) stopCameraScan();

        qr
          // true → affiche l'image et permet parfois une meilleure analyse
          .scanFile(file, true)
          .then((decodedText) => {
            handleQrDecoded(decodedText);
            qr.clear();
            html5QrCode = null;
          })
          .catch((err) => {
            console.error("Erreur de lecture de fichier QR :", err);
            cameraError.textContent =
              "Impossible de lire le QR depuis le fichier : " +
              (err.message || err);
            cameraError.hidden = false;
          });
      })
      .catch((err) => {
        console.error("Erreur Html5Qrcode (scan fichier) :", err);
        cameraError.textContent = "Erreur Html5Qrcode : " + err.message;
        cameraError.hidden = false;
      });
  } catch (err) {
    console.error("Erreur lors de la préparation de la lecture fichier :", err);
    cameraError.textContent =
      "Erreur de préparation de la lecture de fichier : " + (err.message || err);
    cameraError.hidden = false;
  }
}

// =============================
// Décodage / Parsing de la fiche
// =============================

function handleQrDecoded(decodedText) {
  console.log("QR décodé :", decodedText);

  try {
    currentFiche = parseFicheFromQr(decodedText);
    console.log("Fiche parsée :", currentFiche);
    renderFiche(currentFiche);
    setIaButtonsEnabled(true);
  } catch (e) {
    console.error("Erreur lors du parsing du QR :", e);
    alert(
      "Le QR code scanné ne correspond pas à un format de fiche valide.\n" +
        (e.message || e)
    );
  }
}

// Gestion des différents formats JSON + wrapper compressé
function parseFicheFromQr(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error("Contenu du QR invalide : JSON non parsable");
  }

  // Si c'est le wrapper compressé
  if (data && data.z === "pako-base64-v1" && typeof data.d === "string") {
    const jsonStr = decompressFromBase64(data.d);
    data = JSON.parse(jsonStr);
  }

  if (data && data.meta && data.prompt) {
    return data;
  }

  throw new Error(
    "Structure JSON inattendue. Champ 'meta' ou 'prompt' manquant."
  );
}

// =============================
// Rendu de la fiche scannée
// =============================

function renderFiche(fiche) {
  const ficheMeta = document.getElementById("ficheMeta");
  const variablesContainer = document.getElementById("variablesContainer");
  const scanHint = document.getElementById("scanHint");

  scanHint.textContent = "";
  ficheMeta.classList.remove("fiche-meta--empty");

  const {
    categorie,
    titre,
    objectif,
    concepteur,
    date_maj,
    version,
    indices_confiance,
  } = fiche.meta || {};

  ficheMeta.innerHTML = `
    <div class="fiche-meta-title">
      <h2>${escapeHtml(titre || "Titre inconnu")}</h2>
      <span class="fiche-meta-badge">${escapeHtml(
        categorie || "Catégorie non renseignée"
      )}</span>
    </div>
    <p class="fiche-meta-objectif">
      <strong>Objectif :</strong> ${escapeHtml(
        objectif || "Non renseigné"
      )}
    </p>
    <div class="fiche-meta-grid">
      <div><strong>Concepteur :</strong> ${escapeHtml(
        concepteur || "-"
      )}</div>
      <div><strong>Version :</strong> ${escapeHtml(
        version || "-"
      )}</div>
      <div><strong>Date MàJ :</strong> ${escapeHtml(
        date_maj || "-"
      )}</div>
    </div>
    <div class="fiche-meta-indices">
      <span><strong>ChatGPT :</strong> ${formatIndiceConfiance(
        indices_confiance?.chatgpt
      )}</span>
      <span><strong>Perplexity :</strong> ${formatIndiceConfiance(
        indices_confiance?.perplexity
      )}</span>
      <span><strong>Mistral :</strong> ${formatIndiceConfiance(
        indices_confiance?.mistral
      )}</span>
    </div>
  `;

  variablesContainer.innerHTML = "";
  currentVariablesValues = {};

  if (!Array.isArray(fiche.variables) || fiche.variables.length === 0) {
    variablesContainer.innerHTML =
      '<p class="empty-variables">Aucune variable à renseigner pour cette fiche.</p>';
    return;
  }

  fiche.variables.forEach((variable) => {
    const row = document.createElement("div");
    row.className = "variable-row";

    const label = variable.label || variable.id || "Variable";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "variable-input-wrapper";

    let inputEl;

    const type = variable.type || "text";

    if (type === "textarea") {
      inputEl = document.createElement("textarea");
      inputEl.rows = 2;
    } else if (type === "select" && Array.isArray(variable.options)) {
      inputEl = document.createElement("select");
      variable.options.forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt.value ?? opt.label ?? opt;
        o.textContent = opt.label ?? opt;
        inputEl.appendChild(o);
      });
    } else if (type === "number") {
      inputEl = document.createElement("input");
      inputEl.type = "number";
    } else if (type === "geoloc") {
      // Champ de géolocalisation : bouton + lat/long
      inputEl = document.createElement("div");
      inputEl.className = "geoloc-wrapper";

      const btnGeo = document.createElement("button");
      btnGeo.type = "button";
      btnGeo.className = "btn btn-secondary btn-geoloc";
      btnGeo.textContent = "Acquérir la position";

      const latInput = document.createElement("input");
      latInput.type = "text";
      latInput.placeholder = "Latitude";
      latInput.className = "geoloc-lat";

      const lngInput = document.createElement("input");
      lngInput.type = "text";
      lngInput.placeholder = "Longitude";
      lngInput.className = "geoloc-lng";

      inputEl.appendChild(btnGeo);
      inputEl.appendChild(latInput);
      inputEl.appendChild(lngInput);

      btnGeo.addEventListener("click", () => {
        handleGeolocField(latInput, lngInput, variable.id);
      });
    } else {
      inputEl = document.createElement("input");
      inputEl.type = "text";
    }

    inputEl.id = `var-${variable.id}`;
    inputEl.dataset.varId = variable.id;
    inputEl.dataset.varLabel = label;
    inputEl.dataset.varType = type;
    if (variable.required) {
      inputEl.dataset.required = "true";
    }

    if (type !== "geoloc") {
      inputEl.addEventListener("input", () => {
        currentVariablesValues[variable.id] = inputEl.value;
        updatePromptPreview(false);
      });
    }

    inputWrapper.appendChild(inputEl);

    const metaEl = document.createElement("div");
    metaEl.className = "variable-meta";
    metaEl.innerHTML = `
      <span class="var-id">${escapeHtml(variable.id)}</span>
      ${
        variable.required
          ? '<span class="var-required">Obligatoire</span>'
          : '<span class="var-optional">Facultatif</span>'
      }
    `;

    row.appendChild(labelEl);
    row.appendChild(inputWrapper);
    row.appendChild(metaEl);

    variablesContainer.appendChild(row);
  });
}

// Gestion acquisition géoloc
function handleGeolocField(latInput, lngInput, varId) {
  if (!navigator.geolocation) {
    alert(
      "La géolocalisation n'est pas supportée par ce navigateur ou est désactivée."
    );
    return;
  }

  latInput.value = "Acquisition...";
  lngInput.value = "Acquisition...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);

      latInput.value = lat;
      lngInput.value = lng;

      const val = `Latitude : ${lat}, Longitude : ${lng}`;
      currentVariablesValues[varId] = val;
      updatePromptPreview(false);
    },
    (error) => {
      console.error("Erreur de géolocalisation :", error);
      latInput.value = "";
      lngInput.value = "";
      alert(
        "Impossible d'acquérir la position : " + (error.message || "inconnue")
      );
    }
  );
}

// Formatage de l'indice de confiance
function formatIndiceConfiance(value) {
  const v = Number(value);
  if (!v || v < 1 || v > 3) return "Non défini";
  switch (v) {
    case 1:
      return "1 - Usage déconseillé";
    case 2:
      return "2 - Utilisable avec prudence";
    case 3:
      return "3 - Recommandée";
    default:
      return "Non défini";
  }
}

// =============================
// Génération du prompt IA
// =============================

function updatePromptPreview(forceUpdate) {
  if (!currentFiche) return;

  const compiledPrompt = document.getElementById("compiledPrompt");
  const infosComplementaires = document.getElementById("infosComplementaires");

  const filledValues = {};
  const missingRequired = [];

  (currentFiche.variables || []).forEach((variable) => {
    const val = currentVariablesValues[variable.id];
    if (val && val.toString().trim() !== "") {
      filledValues[variable.id] = val;
    } else if (variable.required) {
      missingRequired.push(variable.label || variable.id);
    }
  });

  if (!forceUpdate && missingRequired.length > 0) {
    return;
  }

  let prompt = currentFiche.prompt || "";

  Object.entries(filledValues).forEach(([id, value]) => {
    const pattern = new RegExp(`{{\\s*${escapeRegex(id)}\\s*}}`, "g");
    prompt = prompt.replace(pattern, value);
  });

  prompt = prompt.replace(/{{\s*[\w.-]+\s*}}/g, "(non renseigné)");

  const infos = infosComplementaires.value.trim();
  if (infos) {
    prompt += `\n\nInformations complémentaires fournies par l'utilisateur :\n${infos}`;
  }

  compiledPrompt.value = prompt;
}

function openIa(type) {
  const compiledPrompt = document.getElementById("compiledPrompt");
  const text = compiledPrompt.value.trim();
  if (!text) {
    alert("Aucun prompt généré.");
    return;
  }

  let url = "";

  if (type === "chatgpt") {
    url = "https://chatgpt.com/?q=" + encodeURIComponent(text);
  } else if (type === "perplexity") {
    url = "https://www.perplexity.ai/search?q=" + encodeURIComponent(text);
  } else if (type === "mistral") {
    url = "https://chat.mistral.ai/chat?input=" + encodeURIComponent(text);
  }

  if (url) {
    window.open(url, "_blank");
  }
}

// =============================
// Vue Création de fiche
// =============================

function initCreateView() {
  const addVariableBtn = document.getElementById("addVariableBtn");
  const generateQrBtn = document.getElementById("generateQrBtn");
  const downloadQrBtn = document.getElementById("downloadQrBtn");

  addVariableBtn.addEventListener("click", addVariableRow);
  generateQrBtn.addEventListener("click", onGenerateQrClick);
  downloadQrBtn.addEventListener("click", downloadGeneratedQr);
}

function addVariableRow() {
  const builder = document.getElementById("variablesBuilder");
  const currentRows = builder.querySelectorAll(".builder-row");
  if (currentRows.length >= 10) {
    alert("Nombre maximum de variables (10) déjà atteint.");
    return;
  }

  const row = document.createElement("div");
  row.className = "builder-row";

  row.innerHTML = `
    <input type="text" class="builder-label" placeholder="Label (affiché)" />
    <input type="text" class="builder-id" placeholder="Identifiant (ex : code_onu)" />
    <select class="builder-type">
      <option value="text">Texte</option>
      <option value="textarea">Texte long</option>
      <option value="number">Nombre</option>
      <option value="select">Liste déroulante</option>
      <option value="geoloc">Localisation (latitude / longitude)</option>
    </select>
    <label class="builder-required">
      <input type="checkbox" class="builder-required-checkbox" />
      Obligatoire
    </label>
    <button type="button" class="builder-remove">X</button>
  `;

  const removeBtn = row.querySelector(".builder-remove");
  removeBtn.addEventListener("click", () => {
    row.remove();
  });

  builder.appendChild(row);
}

function onGenerateQrClick() {
  const errorEl = document.getElementById("createError");
  errorEl.hidden = true;
  errorEl.textContent = "";

  let fiche;
  try {
    fiche = buildFicheJsonFromForm();
  } catch (e) {
    errorEl.textContent = e.message || "Erreur lors de la création de la fiche.";
    errorEl.hidden = false;
    return;
  }

  const jsonStr = JSON.stringify(fiche);

  let wrapped;
  try {
    const compressedB64 = compressToBase64(jsonStr);
    wrapped = {
      z: "pako-base64-v1",
      d: compressedB64,
    };
  } catch (e) {
    console.warn("Compression impossible, on garde le JSON brut :", e);
    wrapped = fiche;
  }

  const finalStr = JSON.stringify(wrapped);

  const generatedJson = document.getElementById("generatedJson");
  generatedJson.value = finalStr;

  generateQrCode(finalStr);

  const downloadQrBtn = document.getElementById("downloadQrBtn");
  downloadQrBtn.disabled = false;
}

function buildFicheJsonFromForm() {
  const categorie = document.getElementById("createCategorie").value.trim();
  const titre = document.getElementById("createTitre").value.trim();
  const objectif = document.getElementById("createObjectif").value.trim();
  const concepteur = document.getElementById("createConcepteur").value.trim();
  const date_maj = document.getElementById("createDateMaj").value.trim();
  const version = document.getElementById("createVersion").value.trim();

  const indiceChatgpt = document.getElementById("indiceChatgpt").value;
  const indicePerplexity = document.getElementById("indicePerplexity").value;
  const indiceMistral = document.getElementById("indiceMistral").value;

  const prompt = document.getElementById("createPrompt").value.trim();

  if (!titre) {
    throw new Error("Le titre de la fiche est obligatoire.");
  }
  if (!objectif) {
    throw new Error("L'objectif de la fiche est obligatoire.");
  }
  if (!prompt) {
    throw new Error("Le prompt de la fiche est obligatoire.");
  }

  const builder = document.getElementById("variablesBuilder");
  const rows = builder.querySelectorAll(".builder-row");
  const variables = [];

  rows.forEach((row) => {
    const labelInput = row.querySelector(".builder-label");
    const idInput = row.querySelector(".builder-id");
    const typeSelect = row.querySelector(".builder-type");
    const requiredCheckbox = row.querySelector(".builder-required-checkbox");

    const label = labelInput.value.trim();
    const id = idInput.value.trim();
    const type = typeSelect.value;

    if (!id) {
      throw new Error(
        "Toutes les variables doivent avoir un identifiant (ex : code_onu)."
      );
    }
    if (!label) {
      throw new Error(
        `La variable avec l'identifiant "${id}" doit avoir un label.`
      );
    }

    variables.push({
      label,
      id,
      type,
      required: requiredCheckbox.checked,
    });
  });

  const fiche = {
    meta: {
      categorie,
      titre,
      objectif,
      concepteur,
      date_maj,
      version,
      indices_confiance: {
        chatgpt: Number(indiceChatgpt) || 0,
        perplexity: Number(indicePerplexity) || 0,
        mistral: Number(indiceMistral) || 0,
      },
    },
    variables,
    prompt,
  };

  return removeUndefined(fiche);
}

// Génération du QR code avec taille dynamique
function generateQrCode(text) {
  const qrContainer = document.getElementById("generatedQr");
  qrContainer.innerHTML = "";

  const length = text.length;

  let size = 256;
  if (length > 7000) size = 512;
  else if (length > 4000) size = 384;
  else if (length > 2000) size = 320;

  new QRCode(qrContainer, {
    text,
    width: size,
    height: size,
    correctLevel: QRCode.CorrectLevel.H,
  });
}

function downloadGeneratedQr() {
  const qrContainer = document.getElementById("generatedQr");
  const img = qrContainer.querySelector("img") || qrContainer.querySelector("canvas");
  if (!img) {
    alert("Aucun QR code à télécharger.");
    return;
  }

  let dataUrl;
  if (img.tagName.toLowerCase() === "img") {
    dataUrl = img.src;
  } else {
    dataUrl = img.toDataURL("image/png");
  }

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = "fiche-memento-ia-rch.png";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// =============================
// Utils
// =============================

function escapeHtml(str) {
  if (str == null) return "";
  return str
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeUndefined(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  } else if (obj && typeof obj === "object") {
    const result = {};
    Object.entries(obj).forEach(([key, value]) => {
      if (value === undefined) return;
      result[key] = removeUndefined(value);
    });
    return result;
  }
  return obj;
}

// Compression : JSON string -> base64 deflate
function compressToBase64(str) {
  if (typeof pako === "undefined") {
    throw new Error("pako n'est pas disponible.");
  }
  const encoder = new TextEncoder();
  const utf8 = encoder.encode(str);
  const compressed = pako.deflate(utf8);
  let binary = "";
  for (let i = 0; i < compressed.length; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  return btoa(binary);
}

// Décompression : base64 deflate -> JSON string
function decompressFromBase64(b64) {
  if (typeof pako === "undefined") {
    throw new Error("pako n'est pas disponible.");
  }
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decompressed = pako.inflate(bytes);
  const decoder = new TextDecoder();
  return decoder.decode(decompressed);
}
