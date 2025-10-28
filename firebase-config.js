// Substitua com as chaves do seu projeto Firebase
export const firebaseConfig = {
  apiKey: "AIzaSyDnpVYSC2v3Pbr4DGOxf-sKvcRhFFqtWRE",
  authDomain: "maintence-6ef08.firebaseapp.com",
  projectId: "maintence-6ef08",
  storageBucket: "maintence-6ef08.firebasestorage.app",
  messagingSenderId: "1085348103519",
  appId: "1:1085348103519:web:06c21952276975ab5022ea",
  measurementId: "G-31S2V238QE"
};

// Hash SHA-256 da senha de administrador (não armazene a senha em texto puro)
// Enquanto este valor estiver vazio, a exclusão de pastas/arquivos fica bloqueada.
export const adminPasswordHash = "1234"; // ex.: "e3b0c44298fc1c149afbf4c8996fb924..."