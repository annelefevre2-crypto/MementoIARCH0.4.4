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
      "La librairie Html5Qrcode n'est pas chargée. Vérifiez le script dans index.html."
    );
  }

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("reader");
  }

  return html5QrCode;
}

// =============================
// Tabs
// =============================
function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");

      tabButtons.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(targetId).classList.add("active");
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

  // Bouton caméra = bascule ON/OFF
  cameraBtn.addEventListener("click", () => {
    if (isCameraRunning) {
      stopCameraScan();
    } else {
      startCameraScan();
    }
  });

  // Réinitialisation complète
  resetBtn.addEventListener("click", resetScanView);

  // Lecture depuis un fichier image
  qrFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) scanQrFromFile(file);
  });

  // Mise à jour dynamique du prompt
  infosComplementaires.addEventListener("input", () => updatePromptPreview());

  generatePromptBtn.addEventListener("click", () =>
    updatePromptPreview(true)
  );

  // Boutons d'ouverture des IA
  btnChatgpt.addEventListener("click", () => openIa("chatgpt"));
  btnPerplexity.addEventListener("click", () => openIa("perplexity"));
  btnMistral.addEventListener("click", () => openIa("mistral"));

  setIaButtonsState(null);
}

// --- Caméra ---

function startCameraScan() {
  const cameraError = document.getElementById("cameraError");
  const videoBox = document.getElementById("videoBox");
  const cameraBtn = document.getElementById("cameraBtn");

  cameraError.hidden = true;

  // Si la caméra est déjà en route, on ne fait rien
  if (isCameraRunning) return;

  // Afficher la zone vidéo
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

      // Priorité à la caméra arrière si disponible
      const backCamera = devices.find((d) =>
        d.label.toLowerCase().includes("back")
      );
      const cameraId = backCamera ? backCamera.id : devices[0].id;

      return qr.start(
        cameraId,
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          // Dès qu’un QR est décodé, on traite et on coupe la caméra
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
      if (cameraBtn) {
        cameraBtn.textContent = "Désactiver la caméra";
      }
    })
    .catch((err) => {
      cameraError.textContent =
        "Impossible d'activer la caméra : " + (err?.message || err);
      cameraError.hidden = false;
      videoBox.hidden = true;
      if (cameraBtn) {
        cameraBtn.textContent = "Activer la caméra";
      }
    });
}

function stopCameraScan() {
  const videoBox = document.getElementById("videoBox");
  const cameraBtn = document.getElementById("cameraBtn");

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

  // Cacher la fenêtre vidéo
  videoBox.hidden = true;

  // Remettre le libellé par défaut
  if (cameraBtn) {
    cameraBtn.textContent = "Activer la caméra";
  }
}

// --- Lecture depuis fichier image ---

function scanQrFromFile(file) {
  const cameraError = document.getElementById("cameraError");
  cameraError.hidden = true;

  let qr;
  try {
    qr = ensureHtml5QrCodeInstance();
  } catch (err) {
    cameraError.textContent = "Erreur Html5Qrcode : " + err.message;
    cameraError.hidden = false;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    qr
      .scanFileV2(dataUrl)
      .then((decodedText) => {
        handleQrDecoded(decodedText);
      })
      .catch((err) => {
        cameraError.textContent =
          "Impossible de lire le QR depuis le fichier : " + err;
        cameraError.hidden = false;
      });
  };
  reader.readAsDataURL(file);
}

// --- Décodage générique ---

function handleQrDecoded(decodedText) {
  let ficheObj = null;

  try {
    // 1) On tente le format compacté pako-base64-v1
    const parsed = JSON.parse(decodedText);
    if (parsed && parsed.z === "pako-base64-v1" && typeof parsed.d === "string") {
      const binaryString = atob(parsed.d);
      const binaryLen = binaryString.length;
      const bytes = new Uint8Array(binaryLen);
      for (let i = 0; i < binaryLen; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const inflated = pako.inflate(bytes, { to: "string" });
      ficheObj = JSON.parse(inflated);
    } else {
      // 2) Sinon on considère que c'est un JSON non compacté
      ficheObj = parsed;
    }
  } catch (e) {
    console.warn("Décodage JSON direct impossible, tentative ancien format.", e);
    // 3) Tentative ancien format (simple JSON dans le QR code)
    try {
      ficheObj = JSON.parse(decodedText);
    } catch (e2) {
      alert(
        "Le contenu du QR code n'est pas un JSON valide ou n'utilise pas un format supporté."
      );
      return;
    }
  }

  // À ce stade, ficheObj doit contenir la fiche dans le schéma compact
  // ou un ancien schéma. On s'assure de le normaliser.
  currentFiche = normalizeFicheSchema(ficheObj);
  currentVariablesValues = {};

  renderFicheMeta(currentFiche);
  renderVariablesForm(currentFiche);
  updatePromptPreview();
  setIaButtonsState(currentFiche ? true : null);
}

// Normalisation du schéma de fiche (ancien / nouveau)
function normalizeFicheSchema(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Schéma de fiche invalide.");
  }

  // Si on détecte déjà la forme compacte attendue
  if (
    raw.version &&
    raw.titre &&
    raw.objectif &&
    Array.isArray(raw.variables) &&
    typeof raw.prompt === "string"
  ) {
    return raw;
  }

  // Sinon, on tente de reconstruire à partir d'un ancien format
  const fiche = {
    version: raw.version || "V0",
    titre: raw.titre || raw.Titre || "Fiche sans titre",
    categorie: raw.categorie || raw.Catégorie || "",
    objectif: raw.objectif || raw.Objectif || "",
    references: raw.references || raw["références bibliographique"] || "",
    variables: [],
    prompt: raw.prompt || raw.Prompt || "",
  };

  // Tentative de reconstitution des variables depuis un ancien tableau
  if (Array.isArray(raw.variables)) {
    fiche.variables = raw.variables.map((v, index) => ({
      id: v.id || `var_${index}`,
      label: v.label || v.nom || `Variable ${index + 1}`,
      key:
        v.key ||
        v.nom ||
        `var_${index + 1}`.toLowerCase().replace(/\W+/g, "_"),
      type: v.type || "text",
      obligatoire: !!v.obligatoire,
      commentaire: v.commentaire || "",
    }));
  } else if (Array.isArray(raw["Champs / données d'entrée"])) {
    fiche.variables = raw["Champs / données d'entrée"].map((v, index) => ({
      id: v.id || `var_${index}`,
      label: v.label || v.nom || v || `Variable ${index + 1}`,
      key:
        v.key ||
        v.nom ||
        `var_${index + 1}`.toLowerCase().replace(/\W+/g, "_"),
      type: v.type || "text",
      obligatoire: !!v.obligatoire,
      commentaire: v.commentaire || "",
    }));
  }

  return fiche;
}

function renderFicheMeta(fiche) {
  const ficheMeta = document.getElementById("ficheMeta");
  if (!fiche) {
    ficheMeta.textContent = "Aucune fiche scannée";
    ficheMeta.classList.add("fiche-meta--empty");
    return;
  }

  ficheMeta.classList.remove("fiche-meta--empty");
  ficheMeta.innerHTML = `
    <div><strong>Titre :</strong> ${escapeHtml(fiche.titre)}</div>
    <div><strong>Version :</strong> ${escapeHtml(fiche.version || "N/A")}</div>
    <div><strong>Catégorie :</strong> ${escapeHtml(fiche.categorie || "N/A")}</div>
    <div><strong>Objectif :</strong> ${escapeHtml(fiche.objectif || "N/A")}</div>
    <div><strong>Références :</strong> ${escapeHtml(fiche.references || "N/A")}</div>
  `;
}

function renderVariablesForm(fiche) {
  const container = document.getElementById("variablesContainer");
  container.innerHTML = "";

  if (!fiche || !Array.isArray(fiche.variables) || fiche.variables.length === 0) {
    container.innerHTML =
      '<p class="placeholder">Aucune variable définie dans cette fiche.</p>';
    return;
  }

  fiche.variables.forEach((variable) => {
    const fieldId = `var_${variable.key}`;
    const wrapper = document.createElement("div");
    wrapper.className = "form-field";

    const labelEl = document.createElement("label");
    labelEl.setAttribute("for", fieldId);

    const labelText = variable.obligatoire
      ? `${variable.label} *`
      : variable.label;

    labelEl.textContent = labelText;

    let inputEl;

    // Gestion du type "geoloc" : bouton d'acquisition + lat/long
    if (variable.type === "geoloc") {
      wrapper.classList.add("form-field--geoloc");

      const geolocContainer = document.createElement("div");
      geolocContainer.className = "geoloc-container";

      const btnGeoloc = document.createElement("button");
      btnGeoloc.type = "button";
      btnGeoloc.className = "btn btn-secondary btn-geoloc";
      btnGeoloc.textContent = "Acquérir la position";

      const latInput = document.createElement("input");
      latInput.type = "text";
      latInput.id = `${fieldId}_lat`;
      latInput.placeholder = "Latitude";
      latInput.className = "input geoloc-input";

      const lngInput = document.createElement("input");
      lngInput.type = "text";
      lngInput.id = `${fieldId}_lng`;
      lngInput.placeholder = "Longitude";
      lngInput.className = "input geoloc-input";

      geolocContainer.appendChild(btnGeoloc);
      geolocContainer.appendChild(latInput);
      geolocContainer.appendChild(lngInput);

      wrapper.appendChild(labelEl);
      wrapper.appendChild(geolocContainer);

      btnGeoloc.addEventListener("click", () => {
        if (!navigator.geolocation) {
          alert("La géolocalisation n'est pas supportée par ce navigateur.");
          return;
        }

        btnGeoloc.disabled = true;
        btnGeoloc.textContent = "Acquisition en cours...";

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            latInput.value = latitude.toFixed(6);
            lngInput.value = longitude.toFixed(6);

            currentVariablesValues[`${variable.key}_lat`] = latInput.value;
            currentVariablesValues[`${variable.key}_lng`] = lngInput.value;
            updatePromptPreview();

            btnGeoloc.disabled = false;
            btnGeoloc.textContent = "Acquérir la position";
          },
          (error) => {
            console.error("Erreur géolocalisation:", error);
            alert(
              "Impossible d'acquérir la position. Vérifiez les autorisations du navigateur."
            );
            btnGeoloc.disabled = false;
            btnGeoloc.textContent = "Acquérir la position";
          }
        );
      });

      container.appendChild(wrapper);
      return;
    }

    // Types standards
    if (variable.type === "textarea") {
      inputEl = document.createElement("textarea");
      inputEl.rows = 3;
      inputEl.className = "textarea";
    } else {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.className = "input";
    }

    inputEl.id = fieldId;
    inputEl.dataset.varKey = variable.key;
    inputEl.placeholder = variable.commentaire || "";

    inputEl.addEventListener("input", () => {
      currentVariablesValues[variable.key] = inputEl.value;
      updatePromptPreview();
    });

    wrapper.appendChild(labelEl);
    wrapper.appendChild(inputEl);
    container.appendChild(wrapper);
  });
}

function resetScanView() {
  // Coupe la caméra et ferme la fenêtre vidéo
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

  const cameraBtn = document.getElementById("cameraBtn");
  if (cameraBtn) {
    cameraBtn.textContent = "Activer la caméra";
  }

  setIaButtonsState(null);
}

// =============================
// Génération du prompt
// =============================

function buildPrompt() {
  if (!currentFiche) return "";

  let prompt = currentFiche.prompt || "";

  // Remplacement des variables standards
  if (Array.isArray(currentFiche.variables)) {
    currentFiche.variables.forEach((variable) => {
      if (variable.type === "geoloc") {
        const lat = currentVariablesValues[`${variable.key}_lat`] || "";
        const lng = currentVariablesValues[`${variable.key}_lng`] || "";
        const geolocText =
          lat && lng ? `Latitude ${lat}, Longitude ${lng}` : "";
        const re = new RegExp(`{{\\s*${variable.key}\\s*}}`, "g");
        prompt = prompt.replace(re, geolocText);
      } else {
        const value = currentVariablesValues[variable.key] || "";
        const re = new RegExp(`{{\\s*${variable.key}\\s*}}`, "g");
        prompt = prompt.replace(re, value);
      }
    });
  }

  // Ajout des infos complémentaires à la fin, si non vide
  const infosComplementaires = document.getElementById("infosComplementaires");
  const extra = infosComplementaires.value.trim();
  if (extra) {
    prompt += `\n\nInformations complémentaires fournies par l'utilisateur :\n${extra}`;
  }

  return prompt.trim();
}

function updatePromptPreview(showSuccess = false) {
  const promptFinal = buildPrompt();
  const compiledPromptEl = document.getElementById("compiledPrompt");
  compiledPromptEl.value = promptFinal;

  const successMsg = document.getElementById("successMsg");
  if (showSuccess && promptFinal) {
    successMsg.hidden = false;
    setTimeout(() => {
      successMsg.hidden = true;
    }, 1500);
  }

  // Active / désactive les boutons IA en fonction de l'existence d'un prompt
  if (promptFinal) {
    setIaButtonsState(true);
  } else {
    setIaButtonsState(null);
  }
}

function setIaButtonsState(enabled) {
  const btnChatgpt = document.getElementById("btnChatgpt");
  const btnPerplexity = document.getElementById("btnPerplexity");
  const btnMistral = document.getElementById("btnMistral");

  const buttons = [btnChatgpt, btnPerplexity, btnMistral];

  buttons.forEach((btn) => {
    if (!btn) return;
    if (enabled) {
      btn.disabled = false;
    } else {
      btn.disabled = true;
    }
  });
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

// =============================
// Vue Création de fiche / QR
// =============================

function initCreateView() {
  const addVariableBtn = document.getElementById("addVariableBtn");
  const variablesBuilder = document.getElementById("variablesBuilder");
  const ficheTitre = document.getElementById("ficheTitre");
  const ficheVersion = document.getElementById("ficheVersion");
  const ficheCategorie = document.getElementById("ficheCategorie");
  const ficheObjectif = document.getElementById("ficheObjectif");
  const ficheRefs = document.getElementById("ficheRefs");
  const fichePrompt = document.getElementById("fichePrompt");
  const ficheJson = document.getElementById("ficheJson");
  const downloadQrBtn = document.getElementById("downloadQrBtn");

  const qrCodeContainer = document.getElementById("qrcode");
  const qrSizeInfo = document.getElementById("qrSizeInfo");

  // Initialisation du builder avec une première ligne
  addVariableLine(variablesBuilder);

  addVariableBtn.addEventListener("click", () => {
    addVariableLine(variablesBuilder);
  });

  function refreshFicheJsonAndQr() {
    const fiche = buildFicheFromForm();
    if (!fiche) {
      ficheJson.value = "";
      qrCodeContainer.innerHTML = "";
      qrSizeInfo.textContent =
        "Longueur texte : 0 caractères – taille QR dynamique.";
      return;
    }

    // Conversion en JSON compact
    const ficheJsonStr = JSON.stringify(fiche);

    // Compression DEFLATE + encodage Base64
    const compressed = pako.deflate(ficheJsonStr);
    let binary = "";
    for (let i = 0; i < compressed.length; i++) {
      binary += String.fromCharCode(compressed[i]);
    }
    const base64 = btoa(binary);

    const wrapper = {
      z: "pako-base64-v1",
      d: base64,
    };

    const finalJson = JSON.stringify(wrapper);
    ficheJson.value = finalJson;

    // Génération du QR code avec taille dynamique selon la longueur du texte
    generateDynamicQrCode(qrCodeContainer, finalJson, qrSizeInfo);
  }

  // Mise à jour de la fiche + QR à chaque modification des champs
  [
    ficheTitre,
    ficheVersion,
    ficheCategorie,
    ficheObjectif,
    ficheRefs,
    fichePrompt,
  ].forEach((el) => {
    el.addEventListener("input", refreshFicheJsonAndQr);
  });

  variablesBuilder.addEventListener("input", refreshFicheJsonAndQr);
  variablesBuilder.addEventListener("change", refreshFicheJsonAndQr);

  // Bouton de téléchargement du QR code
  downloadQrBtn.addEventListener("click", () => {
    const canvas = qrCodeContainer.querySelector("canvas");
    const img = qrCodeContainer.querySelector("img");

    if (!canvas && !img) {
      alert("Aucun QR code à télécharger.");
      return;
    }

    let dataUrl;
    if (canvas) {
      dataUrl = canvas.toDataURL("image/png");
    } else {
      dataUrl = img.src;
    }

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "fiche_rch_qr.png";
    link.click();
  });

  // Première génération
  refreshFicheJsonAndQr();
}

function addVariableLine(container) {
  const index = container.children.length;
  const line = document.createElement("div");
  line.className = "variable-row";

  const id = `varBuilder_${index}`;

  line.innerHTML = `
    <div class="variable-row-main">
      <div class="form-field">
        <label for="${id}_label">Libellé</label>
        <input id="${id}_label" type="text" class="input" placeholder="Ex. : Nom du produit" />
      </div>
      <div class="form-field">
        <label for="${id}_key">Clé (pour {{ }} )</label>
        <input id="${id}_key" type="text" class="input" placeholder="Ex. : nom_produit" />
      </div>
    </div>
    <div class="variable-row-meta">
      <div class="form-field">
        <label for="${id}_type">Type</label>
        <select id="${id}_type" class="input">
          <option value="text">Texte</option>
          <option value="textarea">Zone de texte</option>
          <option value="geoloc">Géolocalisation</option>
        </select>
      </div>
      <div class="form-field form-field--inline">
        <label for="${id}_obligatoire">Obligatoire</label>
        <input id="${id}_obligatoire" type="checkbox" />
      </div>
      <div class="form-field">
        <label for="${id}_commentaire">Commentaire / aide</label>
        <input id="${id}_commentaire" type="text" class="input" placeholder="Ex. : code ONU à 4 chiffres" />
      </div>
      <button type="button" class="btn btn-danger btn-remove-variable">Supprimer</button>
    </div>
  `;

  const removeBtn = line.querySelector(".btn-remove-variable");
  removeBtn.addEventListener("click", () => {
    container.removeChild(line);
  });

  container.appendChild(line);
}

function buildFicheFromForm() {
  const ficheTitre = document.getElementById("ficheTitre").value.trim();
  const ficheVersion = document.getElementById("ficheVersion").value.trim();
  const ficheCategorie = document.getElementById("ficheCategorie").value.trim();
  const ficheObjectif = document.getElementById("ficheObjectif").value.trim();
  const ficheRefs = document.getElementById("ficheRefs").value.trim();
  const fichePrompt = document.getElementById("fichePrompt").value.trim();
  const variablesBuilder = document.getElementById("variablesBuilder");

  if (!ficheTitre || !fichePrompt) {
    // On autorise la génération même incomplète, mais sans titre ni prompt on ne fait rien
    if (!ficheTitre && !fichePrompt) {
      return null;
    }
  }

  const variables = [];
  const rows = variablesBuilder.querySelectorAll(".variable-row");
  rows.forEach((row, index) => {
    const labelInput = row.querySelector(`#varBuilder_${index}_label`);
    const keyInput = row.querySelector(`#varBuilder_${index}_key`);
    const typeSelect = row.querySelector(`#varBuilder_${index}_type`);
    const obligatoireCheckbox = row.querySelector(
      `#varBuilder_${index}_obligatoire`
    );
    const commentaireInput = row.querySelector(
      `#varBuilder_${index}_commentaire`
    );

    if (!labelInput || !keyInput) return;

    const label = labelInput.value.trim();
    const keyRaw = keyInput.value.trim();
    if (!label || !keyRaw) return;

    const key = keyRaw.toLowerCase().replace(/\W+/g, "_");

    variables.push({
      id: `var_${index}`,
      label,
      key,
      type: typeSelect ? typeSelect.value : "text",
      obligatoire: !!(obligatoireCheckbox && obligatoireCheckbox.checked),
      commentaire: commentaireInput ? commentaireInput.value.trim() : "",
    });
  });

  const fiche = {
    version: ficheVersion || "V0",
    titre: ficheTitre || "Fiche sans titre",
    categorie: ficheCategorie || "",
    objectif: ficheObjectif || "",
    references: ficheRefs || "",
    variables,
    prompt: fichePrompt || "",
  };

  return fiche;
}

// Génération du QR code avec taille dynamique
function generateDynamicQrCode(container, text, infoEl) {
  container.innerHTML = "";

  const length = text.length;

  let size;
  if (length < 500) {
    size = 200;
  } else if (length < 1500) {
    size = 240;
  } else if (length < 3000) {
    size = 280;
  } else if (length < 5000) {
    size = 320;
  } else if (length < 8000) {
    size = 360;
  } else {
    size = 400;
  }

  infoEl.textContent = `Longueur texte : ${length} caractères – taille QR : ${size}px (dynamique).`;

  new QRCode(container, {
    text,
    width: size,
    height: size,
    correctLevel: QRCode.CorrectLevel.L,
  });
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
