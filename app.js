// ======================================================
// Mémento opérationnel IA – RCH
// app.js — Version 0.4.4 (adaptation taille QR dynamique codage jusqu'à au moins 8800 caractères et geolocalisation; suppression bouton scanner QR code)
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

// =============================
// Gestion des onglets
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
      document.getElementById(`tab-${target}`).classList.add("tab-panel--active");
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

  infosComplementaires.addEventListener("input", () => updatePromptPreview());

  generatePromptBtn.addEventListener("click", () =>
    updatePromptPreview(true)
  );

  btnChatgpt.addEventListener("click", () => openIa("chatgpt"));
  btnPerplexity.addEventListener("click", () => openIa("perplexity"));
  btnMistral.addEventListener("click", () => openIa("mistral"));
}

// ... (tout le reste du fichier reste inchangé :
// startCameraScan, stopCamera, onScanSuccess, parseFicheFromQr, 
// renderFiche, renderVariablesForm, handleGeolocField, updatePromptPreview,
// openIa, initCreateView, buildFicheJson, generateQrCode, etc.)
