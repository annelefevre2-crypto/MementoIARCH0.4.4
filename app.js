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
  if (!window.Html5Qrcode) {
    throw new Error("La bibliothèque Html5Qrcode n'est pas chargée.");
  }
  if (!html5QrCode) {
    // On utilise un conteneur DIV (et non pas directement <video>)
    const cameraContainer = document.getElementById("camera");
    if (!cameraContainer) {
      throw new Error("Élément #camera introuvable dans le DOM.");
    }

    try {
      const config = {
        verbose: false,
      };
      html5QrCode = new Html5Qrcode("camera", config);
    } catch (e) {
      // fallback minimal si la config avancée pose problème
      console.warn("Configuration avancée Html5Qrcode impossible, fallback simple :", e);
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
      tabPanels.forEach((p) => p.classList.remove("tab-panel--active"));

      btn.classList.add("tab-button--active");
      document.getElementById(`tab-${target}`).classList.add("tab-panel--active");

      if (target !== "scan") {
        stopCameraScan();
      }
    });
  });
}

// =============================
// Lecture / Scan
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

  // Un seul bouton pour lancer la caméra
  cameraBtn.addEventListener("click", () => {
    if (!isCameraRunning) {
      startCameraScan();
    }
  });

  // Le reset arrête la caméra et nettoie l'onglet
  resetBtn.addEventListener("click", resetScanView);

  // Lecture d'un QR code depuis un fichier image
  qrFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) scanQrFromFile(file);
  });

  // Mise à jour dynamique de l'aperçu du prompt
  infosComplementaires.addEventListener("input", () => updatePromptPreview());

  generatePromptBtn.addEventListener("click", () =>
    updatePromptPreview(true)
  );

  // Boutons d'envoi vers les IA
  btnChatgpt.addEventListener("click", () => openIa("chatgpt"));
  btnPerplexity.addEventListener("click", () => openIa("perplexity"));
  btnMistral.addEventListener("click", () => openIa("mistral"));

  setIaButtonsState(null);
}

function resetScanView() {
  stopCameraScan();
  currentFiche = null;
  currentVariablesValues = {};

  document.getElementById("ficheMeta").textContent = "Aucune fiche scannée";
  document.getElementById("ficheMeta").classList.add("fiche-meta--empty");
  document.getElementById("variablesContainer").innerHTML = "";
  document.getElementById("infosComplementaires").value = "";
  document.getElementById("compiledPrompt").value = "";
  document.getElementById("cameraError").hidden = true;
  document.getElementById("cameraError").textContent = "";
  document.getElementById("qrFile").value = "";

  setIaButtonsState(null);
}

// --- Caméra ---

function startCameraScan() {
  const cameraError = document.getElementById("cameraError");
  const videoBox = document.getElementById("videoBox");
  cameraError.hidden = true;

  if (isCameraRunning) return;

  videoBox.hidden = false;

  let qr;
  try {
    qr = ensureHtml5QrCodeInstance();
  } catch (err) {
    cameraError.textContent = "Erreur Html5Qrcode : " + err.message;
    cameraError.hidden = false;
    videoBox.hidden = true;
    return;
  }

  Html5Qrcode.getCameras()
    .then((devices) => {
      if (!devices || devices.length === 0) {
        throw new Error("Aucune caméra disponible.");
      }
      const backCamera = devices.find((d) =>
        d.label.toLowerCase().includes("back")
      );
      const cameraId = backCamera ? backCamera.id : devices[0].id;

      return qr.start(
        cameraId,
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          handleQrDecoded(decodedText);
          stopCameraScan();
        },
        (errorMessage) => {
          console.debug("Erreur scan frame:", errorMessage);
        }
      );
    })
    .then(() => {
      isCameraRunning = true;
    })
    .catch((err) => {
      cameraError.textContent =
        "Impossible d'activer la caméra : " + (err?.message || err);
      cameraError.hidden = false;
      videoBox.hidden = true;
    });
}

function stopCameraScan() {
  const videoBox = document.getElementById("videoBox");

  if (html5QrCode && isCameraRunning) {
    html5QrCode
      .stop()
      .then(() => {
        isCameraRunning = false;
      })
      .catch((err) => {
        console.warn("Erreur à l'arrêt de la caméra:", err);
      });
  }

  videoBox.hidden = true;
}

// --- Lecture depuis fichier image ---

function scanQrFromFile(file) {
  const cameraError = document.getElementById("cameraError");
  cameraError.hidden = true;

  let qr;
  try {
    qr = ensureHtml5QrCodeInstance();
  } catch (err) {
    cameraError.textContent = "Erreur Html5Qrcode (fichier) : " + err.message;
    cameraError.hidden = false;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    qr
      .scanFileV2(dataUrl, false)
      .then((decoded) => {
        handleQrDecoded(decoded.text || decoded);
      })
      .catch((err) => {
        cameraError.textContent =
          "Impossible de lire le QR depuis le fichier : " +
          (err?.message || err);
        cameraError.hidden = false;
      });
  };
  reader.readAsDataURL(file);
}

// --- Traitement du QR lu ---

function handleQrDecoded(decodedText) {
  let obj;
  try {
    obj = decodeFicheFromPayload(decodedText);
  } catch (err) {
    alert("Erreur de décodage de la fiche : " + err.message);
    return;
  }

  currentFiche = obj;
  currentVariablesValues = {};
  renderFicheMeta(obj);
  renderVariablesForm(obj);
  updatePromptPreview();
}

// Décodage multi-format (ancien / compact / compressé)
function decodeFicheFromPayload(payload) {
  let jsonText = payload;

  if (payload.startsWith("{")) {
    // JSON direct
  } else {
    // Peut-être wrapper compressé
    try {
      const wrapper = JSON.parse(payload);
      if (wrapper && wrapper.z === "pako-base64-v1" && wrapper.d) {
        const bin = atob(wrapper.d);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
          arr[i] = bin.charCodeAt(i);
        }
        const inflated = pako.inflate(arr, { to: "string" });
        jsonText = inflated;
      } else {
        throw new Error("Wrapper inconnu");
      }
    } catch (e) {
      throw new Error(
        "Format de fiche non reconnu ou compression invalide : " + e.message
      );
    }
  }

  let fiche;
  try {
    fiche = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("JSON de fiche invalide : " + e.message);
  }

  if (!fiche.titre || !fiche.version) {
    throw new Error("Fiche incomplète : titre ou version manquants.");
  }

  fiche.variables = fiche.variables || [];
  return fiche;
}

// --- Rendu fiche & formulaires ---

function renderFicheMeta(fiche) {
  const metaEl = document.getElementById("ficheMeta");
  metaEl.classList.remove("fiche-meta--empty");
  metaEl.innerHTML = `
    <div class="fiche-meta-title">${escapeHtml(fiche.titre || "Sans titre")}</div>
    <div class="fiche-meta-details">
      <span>Version : ${escapeHtml(fiche.version || "?")}</span>
      ${
        fiche.categorie
          ? `<span>Catégorie : ${escapeHtml(fiche.categorie)}</span>`
          : ""
      }
      ${
        fiche.objectif
          ? `<span>Objectif : ${escapeHtml(fiche.objectif)}</span>`
          : ""
      }
    </div>
  `;
}

function renderVariablesForm(fiche) {
  const container = document.getElementById("variablesContainer");
  container.innerHTML = "";

  if (!fiche.variables || fiche.variables.length === 0) {
    const p = document.createElement("p");
    p.textContent = "Aucun champ d'entrée défini pour cette fiche.";
    p.className = "helper-text";
    container.appendChild(p);
    return;
  }

  fiche.variables.forEach((v, index) => {
    const row = document.createElement("div");
    row.className = "variable-row";

    const label = document.createElement("label");
    label.className = "section-label";
    const obligatoire = v.obligatoire === true ? " (obligatoire)" : "";
    label.textContent = (v.nom || `Champ ${index + 1}`) + obligatoire;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "input";
    input.placeholder = v.placeholder || "";
    input.value = "";

    input.addEventListener("input", () => {
      currentVariablesValues[v.id || v.nom || `var_${index}`] = input.value;
      updatePromptPreview();
    });

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  });
}

// --- Génération du prompt ---

function updatePromptPreview(force = false) {
  if (!currentFiche) {
    document.getElementById("compiledPrompt").value = "";
    setIaButtonsState(null);
    return;
  }

  const infosCompl = document
    .getElementById("infosComplementaires")
    .value.trim();

  let prompt = currentFiche.prompt || "";
  const vars = currentFiche.variables || [];

  vars.forEach((v, index) => {
    const key = v.id || v.nom || `var_${index}`;
    const val = currentVariablesValues[key] || "";
    const token = `{{${key}}}`;
    prompt = prompt.replaceAll(token, val);
  });

  if (infosCompl) {
    prompt += `\n\nInformations complémentaires transmises par le COS :\n${infosCompl}`;
  }

  document.getElementById("compiledPrompt").value = prompt;
  setIaButtonsState(prompt ? "ready" : null);
}

// --- Boutons IA ---

function setIaButtonsState(state) {
  const btnChatgpt = document.getElementById("btnChatgpt");
  const btnPerplexity = document.getElementById("btnPerplexity");
  const btnMistral = document.getElementById("btnMistral");
  const enabled = state === "ready";

  [btnChatgpt, btnPerplexity, btnMistral].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !enabled;
  });
}

function openIa(type) {
  const prompt = document.getElementById("compiledPrompt").value.trim();
  if (!prompt) return;

  const encoded = encodeURIComponent(prompt);

  let url = "";
  switch (type) {
    case "chatgpt":
      url = `https://chat.openai.com/?q=${encoded}`;
      break;
    case "perplexity":
      url = `https://www.perplexity.ai/?q=${encoded}`;
      break;
    case "mistral":
      url = `https://chat.mistral.ai/chat?prompt=${encoded}`;
      break;
    default:
      return;
  }

  window.open(url, "_blank");
}

// =============================
// Création de fiche
// =============================

function initCreateView() {
  const addVariableBtn = document.getElementById("addVariableBtn");
  const generateJsonBtn = document.getElementById("generateJsonBtn");
  const copyJsonBtn = document.getElementById("copyJsonBtn");
  const downloadQrBtn = document.getElementById("downloadQrBtn");

  addVariableBtn.addEventListener("click", addVariableRow);

  generateJsonBtn.addEventListener("click", () => {
    const fiche = collectFicheFromForm();
    if (!fiche) return;

    const jsonCompact = createCompactFicheJson(fiche);
    const payload = createCompressedPayload(jsonCompact);

    const output = {
      fiche,
      compact: jsonCompact,
      payload,
    };

    const jsonOutputEl = document.getElementById("jsonOutput");
    jsonOutputEl.value = JSON.stringify(output, null, 2);
    copyJsonBtn.disabled = false;

    generateQrCode(payload);
  });

  copyJsonBtn.addEventListener("click", () => {
    const jsonOutputEl = document.getElementById("jsonOutput");
    if (!jsonOutputEl.value) return;
    navigator.clipboard
      .writeText(jsonOutputEl.value)
      .then(() => {
        alert("JSON copié dans le presse-papier.");
      })
      .catch((err) => {
        console.error("Erreur lors de la copie :", err);
      });
  });

  downloadQrBtn.addEventListener("click", () => {
    const canvas = document.querySelector("#generatedQr canvas");
    if (!canvas) return;

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "fiche-qr.png";
    link.click();
  });
}

// --- Ajout / collecte des variables ---

function addVariableRow() {
  const container = document.getElementById("variablesCreateContainer");

  const row = document.createElement("div");
  row.className = "variable-row variable-row--create";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Nom du champ (ex : Code ONU)";
  nameInput.className = "input variable-input-name";

  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.placeholder = "Identifiant (ex : code_onu)";
  idInput.className = "input variable-input-id";

  const placeholderInput = document.createElement("input");
  placeholderInput.type = "text";
  placeholderInput.placeholder = "Texte d'aide / exemple";
  placeholderInput.className = "input variable-input-placeholder";

  const obligatoireSelect = document.createElement("select");
  obligatoireSelect.className = "input variable-input-obligatoire";
  obligatoireSelect.innerHTML = `
    <option value="false">Facultatif</option>
    <option value="true">Obligatoire</option>
  `;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-ghost";
  removeBtn.textContent = "Supprimer";
  removeBtn.addEventListener("click", () => row.remove());

  row.appendChild(nameInput);
  row.appendChild(idInput);
  row.appendChild(placeholderInput);
  row.appendChild(obligatoireSelect);
  row.appendChild(removeBtn);

  container.appendChild(row);
}

function collectFicheFromForm() {
  const titre = document.getElementById("ficheTitre").value.trim();
  const categorie = document.getElementById("ficheCategorie").value.trim();
  const version = document.getElementById("ficheVersion").value.trim();
  const objectif = document.getElementById("ficheObjectif").value.trim();
  const references = document.getElementById("ficheReferences").value.trim();
  const promptBrut = document.getElementById("promptBrut").value.trim();

  if (!titre || !version) {
    alert("Le titre et la version sont obligatoires.");
    return null;
  }

  if (!promptBrut) {
    alert("Le prompt brut ne peut pas être vide.");
    return null;
  }

  const variables = [];
  const rows = document.querySelectorAll(".variable-row--create");
  rows.forEach((row, index) => {
    const nameInput = row.querySelector(".variable-input-name");
    const idInput = row.querySelector(".variable-input-id");
    const placeholderInput = row.querySelector(".variable-input-placeholder");
    const obligatoireSelect = row.querySelector(".variable-input-obligatoire");

    const nom = nameInput.value.trim();
    const id = (idInput.value || nom || `var_${index + 1}`).trim();
    const placeholder = placeholderInput.value.trim();
    const obligatoire = obligatoireSelect.value === "true";

    if (!nom && !id) {
      return;
    }

    variables.push({
      nom,
      id,
      placeholder,
      obligatoire,
    });
  });

  const fiche = {
    titre,
    categorie,
    version,
    objectif,
    references,
    prompt: promptBrut,
    variables,
  };

  return fiche;
}

// --- Création JSON compact & payload compressé ---

function createCompactFicheJson(fiche) {
  return {
    t: fiche.titre,
    c: fiche.categorie,
    v: fiche.version,
    o: fiche.objectif,
    r: fiche.references,
    p: fiche.prompt,
    vars: (fiche.variables || []).map((v) => ({
      n: v.nom,
      i: v.id,
      ph: v.placeholder,
      ob: v.obligatoire ? 1 : 0,
    })),
  };
}

function createCompressedPayload(objCompact) {
  const json = JSON.stringify(objCompact);
  const utf8Arr = new TextEncoder().encode(json);
  const deflated = pako.deflate(utf8Arr);
  let binary = "";
  deflated.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const base64 = btoa(binary);

  return JSON.stringify({
    z: "pako-base64-v1",
    d: base64,
  });
}

// --- Génération du QR code ---

function generateQrCode(payload) {
  const container = document.getElementById("generatedQr");
  container.innerHTML = "";

  const length = payload.length;
  let size = 256;

  if (length > 600 && length <= 1200) size = 320;
  else if (length > 1200 && length <= 2400) size = 384;
  else if (length > 2400 && length <= 3600) size = 448;
  else if (length > 3600) size = 512;

  QRCode.toCanvas(
    payload,
    {
      errorCorrectionLevel: "M",
      width: size,
      margin: 2,
    },
    (err, canvas) => {
      if (err) {
        console.error("Erreur lors de la génération du QR code :", err);
        alert("Erreur lors de la génération du QR code.");
        return;
      }
      container.appendChild(canvas);
      document.getElementById("downloadQrBtn").disabled = false;
    }
  );
}

// =============================
// Utilitaires
// =============================

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
