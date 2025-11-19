// ======================================================
// Mémento opérationnel IA – RCH
// app.js — Version 0.4.6 (QrScanner, 1 seul bouton caméra)
// ------------------------------------------------------
// - QrScanner (caméra + fichiers) avec priorité caméra arrière
// - Un seul bouton "Activer la caméra" (toggle ON/OFF)
// - Détection automatique du premier QR dans le flux
// - Lecture de QR JSON → génération des champs variables
// - Concatenation du prompt + infos complémentaires
// - Création du JSON de fiche + QR code
//   * schéma compact
//   * compression DEFLATE + Base64 (pako)
//   * wrapper { z: "pako-base64-v1", d: "<base64>" }
// - Lecture compatible : ancien format, compact, compact+compressé
// - Ajustement de la taille du QR en fonction de la longueur du texte
// ======================================================

// État global
let scanner = null;                // instance QrScanner pour la caméra
let isCameraRunning = false;       // état de la caméra
let currentFiche = null;           // fiche courante décodée depuis le QR
let currentVariablesValues = {};   // valeurs saisies dans les variables
let html5QrCode = null;             // POUR la lecture de fichiers (Html5Qrcode)
let qrScanner = null;               // POUR la caméra (QrScanner)


// =============================
// Initialisation
// =============================

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initScanView();
  initCreateView();
});

// Helper : vérifie la présence de la lib QrScanner
function ensureQrScannerAvailable() {
  if (typeof QrScanner === "undefined") {
    throw new Error(
      "QrScanner n'est pas chargé (vérifier le script dans index.html)."
    );
  }
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
        if (panel.id === `tab-${target}`) {
          panel.classList.add("tab-panel--active");
        } else {
          panel.classList.remove("tab-panel--active");
        }
      });
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

  // Un seul bouton : démarre la caméra (si pas déjà lancée)
  cameraBtn.addEventListener("click", () => {
    if (!isCameraRunning) {
      startCameraScan();
    }
  });

  resetBtn.addEventListener("click", resetScanView);

  qrFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) scanQrFromFile(file);
  });

  infosComplementaires.addEventListener("input", () => updatePromptPreview());

  generatePromptBtn.addEventListener("click", () =>
    updatePromptPreview(true)
  );

  btnChatgpt.addEventListener("click", () => openIa("chatgpt"));
  btnPerplexity.addEventListener("click", () => openIa("perplexity"));
  btnMistral.addEventListener("click", () => openIa("mistral"));

  setIaButtonsState(null);
}


// --- Caméra (QrScanner) ---

function startCameraScan() {
  const cameraError = document.getElementById("cameraError");
  const videoBox = document.getElementById("videoBox");
  cameraError.hidden = true;
  cameraError.textContent = "";

  // Si la caméra tourne déjà, on ne relance pas
  if (isCameraRunning) return;

  videoBox.hidden = false;

  // Arrête un éventuel scanner précédent
  if (qrScanner) {
    try {
      qrScanner.stop();
      qrScanner.destroy();
    } catch (e) {
      console.warn("Erreur à l'arrêt de l'ancien scanner :", e);
    }
    qrScanner = null;
  }

  const videoEl = document.getElementById("camera");

  try {
    // Callback à chaque décodage : on arrête la caméra après la 1re lecture
    qrScanner = new QrScanner(
      videoEl,
      (result) => {
        const decodedText = result && result.data ? result.data : result;
        stopCameraScan();
        handleQrDecoded(decodedText);
      },
      {
        highlightScanRegion: true,
        highlightCodeOutline: true
      }
    );
  } catch (err) {
    cameraError.textContent =
      "Erreur lors de l'initialisation de la caméra : " + (err?.message || err);
    cameraError.hidden = false;
    videoBox.hidden = true;
    return;
  }

  // Sélection prioritaire de la caméra arrière si disponible
  QrScanner.listCameras(true)
    .then((cameras) => {
      if (!cameras || cameras.length === 0) {
        throw new Error("Aucune caméra disponible.");
      }

      const backCam =
        cameras.find((c) =>
          /back|rear|environment/i.test(c.label || "")
        ) || cameras[0];

      return qrScanner.start(backCam.id);
    })
    .then(() => {
      isCameraRunning = true;
    })
    .catch((err) => {
      cameraError.textContent =
        "Impossible d'activer la caméra : " + (err?.message || err);
      cameraError.hidden = false;
      videoBox.hidden = true;

      try {
        if (qrScanner) {
          qrScanner.stop();
          qrScanner.destroy();
        }
      } catch (e2) {
        console.warn("Erreur supplémentaire à l'arrêt de la caméra :", e2);
      }
      qrScanner = null;
      isCameraRunning = false;
    });
}


function stopCameraScan() {
  const videoBox = document.getElementById("videoBox");

  if (qrScanner) {
    qrScanner
      .stop()
      .then(() => {
        qrScanner.destroy();
        qrScanner = null;
        isCameraRunning = false;
      })
      .catch((err) => {
        console.warn("Erreur à l'arrêt du scanner caméra :", err);
        qrScanner.destroy();
        qrScanner = null;
        isCameraRunning = false;
      });
  } else {
    isCameraRunning = false;
  }

  if (videoBox) {
    videoBox.hidden = true;
  }
}


// --- Lecture depuis fichier image (QrScanner.scanImage) ---

function scanQrFromFile(file) {
  const cameraError = document.getElementById("cameraError");
  cameraError.hidden = true;
  cameraError.textContent = "";

  try {
    ensureQrScannerAvailable();
  } catch (err) {
    cameraError.textContent = "Erreur QrScanner : " + err.message;
    cameraError.hidden = false;
    return;
  }

  if (isCameraRunning) {
    stopCameraScan();
  }

  QrScanner.scanImage(file, { returnDetailedScanResult: true })
    .then((result) => {
      const decodedText = result?.data || result;
      handleQrDecoded(decodedText);
    })
    .catch((err) => {
      console.error("Erreur scanImage :", err);
      cameraError.textContent =
        "Impossible de lire le QR depuis le fichier. " +
        "L'image est probablement trop petite, floue ou le code trop dense. " +
        "Détail technique : " +
        (err?.message || err);
      cameraError.hidden = false;
    });
}

// --- Traitement du JSON issu du QR ---

function handleQrDecoded(decodedText) {
  let obj;
  try {
    obj = JSON.parse(decodedText);
  } catch (e) {
    alert("Le QR code ne contient pas un JSON valide.\nDétail : " + e.message);
    return;
  }

  // 1) Nouveau format : wrapper compressé { z: "pako-base64-v1", d: "<base64>" }
  if (obj && obj.z === "pako-base64-v1" && obj.d) {
    try {
      const compactJson = decompressFromBase64(obj.d);
      const compactObj = JSON.parse(compactJson);
      obj =
        compactObj && compactObj.ti && !compactObj.titre
          ? expandCompactSchema(compactObj)
          : compactObj;
    } catch (e) {
      alert(
        "Impossible de décompresser les données du QR code.\nDétail : " +
          e.message
      );
      return;
    }
  }
  // 2) Ancien format compact non compressé (ti/obj/v/ic)
  else if (obj && obj.ti && !obj.titre) {
    obj = expandCompactSchema(obj);
  }
  // 3) Sinon : on suppose déjà le schéma "long" compatible.

  currentFiche = obj;
  currentVariablesValues = {};

  renderFicheMeta();
  renderVariablesForm();
  updatePromptPreview();
  setIaButtonsState(currentFiche.indices_confiance || null);
}

// --- Affichage méta fiche ---

function renderFicheMeta() {
  const ficheMeta = document.getElementById("ficheMeta");

  if (!currentFiche) {
    ficheMeta.textContent = "Aucune fiche scannée";
    ficheMeta.classList.add("fiche-meta--empty");
    return;
  }

  const { categorie, titre, objectif, concepteur, date_maj, version } =
    currentFiche;

  const parts = [];
  if (categorie) parts.push("<strong>" + escapeHtml(categorie) + "</strong>");
  if (titre) parts.push("<span>" + escapeHtml(titre) + "</span>");
  if (objectif) parts.push("<br><em>" + escapeHtml(objectif) + "</em>");
  if (version || date_maj || concepteur) {
    const metaParts = [];
    if (version) metaParts.push("Version " + escapeHtml(version));
    if (date_maj) metaParts.push("MAJ : " + escapeHtml(date_maj));
    if (concepteur) metaParts.push("Concepteur : " + escapeHtml(concepteur));
    parts.push("<br><span>" + metaParts.join(" — ") + "</span>");
  }

  ficheMeta.innerHTML = parts.join(" ");
  ficheMeta.classList.remove("fiche-meta--empty");
}

// --- Formulaire de variables (lecture) ---

function renderVariablesForm() {
  const container = document.getElementById("variablesContainer");
  container.innerHTML = "";

  if (!currentFiche || !Array.isArray(currentFiche.variables)) return;

  currentFiche.variables.slice(0, 10).forEach((variable) => {
    const { id, label, type = "text", obligatoire = false, placeholder = "" } =
      variable;
    if (!id) return;

    const fieldDiv = document.createElement("div");
    fieldDiv.className = "variable-field";

    const labelEl = document.createElement("label");
    labelEl.className = "variable-label";
    labelEl.setAttribute("for", "var-" + id);
    labelEl.textContent = label || id;

    if (obligatoire) {
      const star = document.createElement("span");
      star.className = "obligatoire";
      star.textContent = "*";
      labelEl.appendChild(star);
    }

    let inputEl;
    if (type === "number") {
      inputEl = document.createElement("input");
      inputEl.type = "number";
    } else if (type === "file") {
      inputEl = document.createElement("input");
      inputEl.type = "file";
    } else if (type === "geoloc") {
      inputEl = document.createElement("input");
      inputEl.type = "text";
    } else {
      inputEl = document.createElement("input");
      inputEl.type = "text";
    }

    inputEl.id = "var-" + id;
    inputEl.dataset.varId = id;
    inputEl.dataset.varObligatoire = String(obligatoire);
    inputEl.placeholder = placeholder || "";

    inputEl.addEventListener("input", () => {
      currentVariablesValues[id] =
        inputEl.type === "file"
          ? (inputEl.files && inputEl.files[0] && inputEl.files[0].name) || ""
          : inputEl.value;
      updatePromptPreview();
    });

    fieldDiv.appendChild(labelEl);
    fieldDiv.appendChild(inputEl);
    container.appendChild(fieldDiv);
  });
}

// --- Construction du prompt final ---

function buildPrompt() {
  if (!currentFiche || !currentFiche.prompt) return "";

  let prompt = currentFiche.prompt;

  if (Array.isArray(currentFiche.variables)) {
    currentFiche.variables.forEach((v) => {
      if (!v.id) return;
      const value = currentVariablesValues[v.id] || "";
      const placeholder = new RegExp(
        "{{\\s*" + escapeRegex(v.id) + "\\s*}}",
        "g"
      );
      prompt = prompt.replace(placeholder, value);
    });
  }

  const infosComplementaires = document.getElementById("infosComplementaires");
  const extra = infosComplementaires.value.trim();
  if (extra) {
    prompt += "\n\nInformations complémentaires : " + extra;
  }

  return prompt;
}

function updatePromptPreview(scrollToPrompt = false) {
  const compiledPrompt = document.getElementById("compiledPrompt");
  const promptFinal = buildPrompt();
  compiledPrompt.value = promptFinal || "";

  const allRequiredFilled = checkAllRequiredVariablesFilled();
  if (!allRequiredFilled) {
    setIaButtonsDisableAll();
  } else {
    const indices = currentFiche && currentFiche.indices_confiance;
    setIaButtonsState(indices || null);
  }

  if (scrollToPrompt) {
    compiledPrompt.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function checkAllRequiredVariablesFilled() {
  if (!currentFiche || !Array.isArray(currentFiche.variables)) return false;

  return currentFiche.variables.every((v) => {
    if (!v.obligatoire) return true;
    const value = currentVariablesValues[v.id];
    return value !== undefined && String(value).trim() !== "";
  });
}

// --- Boutons IA ---

function setIaButtonsDisableAll() {
  const btnChatgpt = document.getElementById("btnChatgpt");
  const btnPerplexity = document.getElementById("btnPerplexity");
  const btnMistral = document.getElementById("btnMistral");

  [btnChatgpt, btnPerplexity, btnMistral].forEach((btn) => {
    btn.disabled = true;
    btn.classList.remove("btn-ia--level3", "btn-ia--level2");
    btn.classList.add("btn-ia--disabled");
  });
}

function setIaButtonsState(indices) {
  const btnChatgpt = document.getElementById("btnChatgpt");
  const btnPerplexity = document.getElementById("btnPerplexity");
  const btnMistral = document.getElementById("btnMistral");

  if (!currentFiche || !indices) {
    setIaButtonsDisableAll();
    return;
  }

  const applyState = (btn, level) => {
    btn.classList.remove("btn-ia--level3", "btn-ia--level2", "btn-ia--disabled");
    if (level === 3) {
      btn.disabled = false;
      btn.classList.add("btn-ia--level3");
    } else if (level === 2) {
      btn.disabled = false;
      btn.classList.add("btn-ia--level2");
    } else {
      btn.disabled = true;
      btn.classList.add("btn-ia--disabled");
    }
  };

  const lvlChatgpt = normalizeIndice(indices.chatgpt);
  const lvlPerplexity = normalizeIndice(indices.perplexity);
  const lvlMistral = normalizeIndice(indices.mistral);

  applyState(btnChatgpt, lvlChatgpt);
  applyState(btnPerplexity, lvlPerplexity);
  applyState(btnMistral, lvlMistral);
}

function normalizeIndice(value) {
  const n = Number(value);
  if (n === 3 || n === 2 || n === 1) return n;
  return 1;
}

function openIa(iaKey) {
  if (!currentFiche) return;

  const promptFinal = buildPrompt();
  if (!promptFinal) {
    alert("Le prompt est vide. Veuillez remplir les champs de la fiche.");
    return;
  }

  const encoded = encodeURIComponent(promptFinal);
  let url = "";

  switch (iaKey) {
    case "chatgpt":
      url = "https://chatgpt.com/?q=" + encoded;
      break;
    case "perplexity":
      url = "https://www.perplexity.ai/search?q=" + encoded;
      break;
    case "mistral":
      url = "https://chat.mistral.ai/chat?q=" + encoded;
      break;
    default:
      return;
  }

  window.open(url, "_blank", "noopener");
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

// =============================
// Vue Création de fiche / QR
// =============================

function initCreateView() {
  const addVariableBtn = document.getElementById("addVariableBtn");
  const generateQrBtn = document.getElementById("generateQrBtn");
  const downloadQrBtn = document.getElementById("downloadQrBtn");

  addVariableRow();

  addVariableBtn.addEventListener("click", addVariableRow);
  generateQrBtn.addEventListener("click", generateJsonAndQr);
  downloadQrBtn.addEventListener("click", downloadGeneratedQr);
}

// Ajoute une ligne de variable dans le builder (max 10)
function addVariableRow() {
  const builder = document.getElementById("variablesBuilder");
  const currentRows = builder.querySelectorAll(".variable-row");

  if (currentRows.length >= 10) {
    alert("Vous avez atteint le nombre maximal de 10 variables.");
    return;
  }

  const row = document.createElement("div");
  row.className = "variable-row";

  const inputLabel = document.createElement("input");
  inputLabel.type = "text";
  inputLabel.placeholder = "Label (ex : Code ONU)";

  const inputId = document.createElement("input");
  inputId.type = "text";
  inputId.placeholder = "Identifiant (ex : code_onu)";

  const selectType = document.createElement("select");
  ["text", "number", "geoloc", "file"].forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    selectType.appendChild(opt);
  });

  const requiredContainer = document.createElement("div");
  requiredContainer.className = "var-required";

  const checkboxRequired = document.createElement("input");
  checkboxRequired.type = "checkbox";

  const labelRequired = document.createElement("label");
  labelRequired.textContent = "Obligatoire";

  requiredContainer.appendChild(checkboxRequired);
  requiredContainer.appendChild(labelRequired);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-secondary";
  deleteBtn.textContent = "Supprimer";
  deleteBtn.addEventListener("click", () => row.remove());

  row.appendChild(inputLabel);
  row.appendChild(inputId);
  row.appendChild(selectType);
  row.appendChild(requiredContainer);
  row.appendChild(deleteBtn);

  builder.appendChild(row);
}

// Génération du JSON + QR
function generateJsonAndQr() {
  const errorBox = document.getElementById("createError");
  const jsonTextarea = document.getElementById("generatedJson");
  const qrContainer = document.getElementById("generatedQr");
  const downloadBtn = document.getElementById("downloadQrBtn");

  errorBox.hidden = true;
  errorBox.textContent = "";
  jsonTextarea.value = "";
  qrContainer.innerHTML = "";
  downloadBtn.disabled = true;

  const categorie = document.getElementById("createCategorie").value.trim();
  const titre = document.getElementById("createTitre").value.trim();
  const objectif = document.getElementById("createObjectif").value.trim();
  const concepteur = document.getElementById("createConcepteur").value.trim();
  const dateMaj = document.getElementById("createDateMaj").value.trim();
  const version = document.getElementById("createVersion").value.trim();
  const prompt = document.getElementById("createPrompt").value;

  const indiceChatgpt = document.getElementById("indiceChatgpt").value;
  const indicePerplexity = document.getElementById("indicePerplexity").value;
  const indiceMistral = document.getElementById("indiceMistral").value;

  const errors = [];
  if (!titre) errors.push("Le titre de la fiche est obligatoire.");
  if (!objectif) errors.push("L'objectif de la fiche est obligatoire.");
  if (!concepteur) errors.push("Le nom du concepteur est obligatoire.");
  if (!version) errors.push("La version est obligatoire.");
  if (!prompt.trim()) errors.push("Le prompt de la fiche ne doit pas être vide.");

  const variables = [];
  const rows = document.querySelectorAll("#variablesBuilder .variable-row");
  const ids = new Set();

  rows.forEach((row, index) => {
    const inputs = row.querySelectorAll("input, select");

    const inputLabel = inputs[0];
    const inputId = inputs[1];
    const selectType = inputs[2];
    const checkboxRequired = inputs[3];

    const label = inputLabel.value.trim();
    const id = inputId.value.trim();
    const type = selectType.value;
    const obligatoire = checkboxRequired.checked;

    if (!label && !id) return;

    if (!label) {
      errors.push("Variable #" + (index + 1) + " : le label est obligatoire.");
    }
    if (!id) {
      errors.push(
        "Variable #" + (index + 1) + " : l'identifiant est obligatoire."
      );
    }
    if (id && ids.has(id)) {
      errors.push(
        'Variable #' +
          (index + 1) +
          ' : l\'identifiant "' +
          id +
          '" est déjà utilisé.'
      );
    }
    if (id) ids.add(id);

    variables.push({
      id,
      label,
      type,
      obligatoire
    });
  });

  if (errors.length > 0) {
    errorBox.textContent = errors.join(" ");
    errorBox.hidden = false;
    return;
  }

  // 1) Objet "long" pour l'affichage JSON
  const ficheObject = {
    categorie: categorie || undefined,
    titre,
    objectif,
    variables,
    prompt,
    indices_confiance: {
      chatgpt: Number(indiceChatgpt),
      perplexity: Number(indicePerplexity),
      mistral: Number(indiceMistral)
    },
    concepteur,
    date_maj: dateMaj || undefined,
    version
  };

  const cleaned = removeUndefined(ficheObject);
  const jsonFormatted = JSON.stringify(cleaned, null, 2);
  jsonTextarea.value = jsonFormatted;

  // 2) Schéma compact pour le QR
  const compact = {
    c: cleaned.categorie,
    ti: cleaned.titre,
    obj: cleaned.objectif,
    v: Array.isArray(cleaned.variables)
      ? cleaned.variables.map((v) => ({
          i: v.id,
          l: v.label,
          t: v.type,
          o: v.obligatoire
        }))
      : [],
    pr: cleaned.prompt,
    ic: cleaned.indices_confiance
      ? {
          c: cleaned.indices_confiance.chatgpt,
          p: cleaned.indices_confiance.perplexity,
          m: cleaned.indices_confiance.mistral
        }
      : undefined,
    cp: cleaned.concepteur,
    d: cleaned.date_maj,
    ve: cleaned.version
  };

  const compactCleaned = removeUndefined(compact);
  const compactJson = JSON.stringify(compactCleaned);

  if (typeof QRCode !== "function") {
    alert("La librairie QRCode n'est pas disponible.");
    return;
  }

  // 3) Compression + wrapper
  let qrText;
  try {
    if (typeof pako !== "undefined") {
      const base64 = compressToBase64(compactJson);
      qrText = JSON.stringify({ z: "pako-base64-v1", d: base64 });
    } else {
      console.warn(
        "pako n'est pas chargé, utilisation du JSON compact non compressé."
      );
      qrText = compactJson;
    }
  } catch (e) {
    console.error("Erreur lors de la compression :", e);
    qrText = compactJson; // fallback non compressé
  }

  // 4) Détermination dynamique de la taille du QR
  const len = qrText.length;
  let size = 300;          // valeur par défaut
  if (len > 1800) size = 400;
  if (len > 2600) size = 500;
  if (len > 3400) size = 600;

  try {
    new QRCode(qrContainer, {
      text: qrText,
      width: size,
      height: size,
      correctLevel: QRCode.CorrectLevel.L // niveau bas pour limiter la densité
    });
    downloadBtn.disabled = false;
  } catch (e) {
    console.error("Erreur génération QR :", e);
    if (String(e).includes("code length overflow")) {
      errorBox.textContent =
        "Le contenu de la fiche est trop volumineux pour être encodé dans un QR code. " +
        "Réduisez la taille des textes (objectif, prompt, nombre de variables…) puis réessayez.";
    } else {
      errorBox.textContent =
        "Erreur lors de la génération du QR code : " + e.message;
    }
    errorBox.hidden = false;
  }
}

// Téléchargement de l'image du QR code généré
function downloadGeneratedQr() {
  const qrContainer = document.getElementById("generatedQr");
  const canvas = qrContainer.querySelector("canvas");

  if (!canvas) {
    alert("Aucun QR code à télécharger.");
    return;
  }

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = "fiche-ia-qr.png";
  link.click();
}

// =============================
// Conversion compact -> long
// =============================

function expandCompactSchema(compact) {
  const variables = Array.isArray(compact.v)
    ? compact.v.map((v) => ({
        id: v.i,
        label: v.l,
        type: v.t,
        obligatoire: v.o
      }))
    : [];

  const indices = compact.ic
    ? {
        chatgpt: compact.ic.c,
        perplexity: compact.ic.p,
        mistral: compact.ic.m
      }
    : undefined;

  const full = {
    categorie: compact.c,
    titre: compact.ti,
    objectif: compact.obj,
    variables,
    prompt: compact.pr,
    indices_confiance: indices,
    concepteur: compact.cp,
    date_maj: compact.d,
    version: compact.ve
  };

  return removeUndefined(full);
}

// =============================
// Utilitaires
// =============================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegex(str) {
  return String(str).replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function removeUndefined(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  }
  if (obj && typeof obj === "object") {
    const result = {};
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
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
