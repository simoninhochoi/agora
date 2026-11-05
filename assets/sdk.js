// Firebase SDK를 한 곳에서 버전 고정해 불러온다.
export { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
export {
  getAuth, onAuthStateChanged, signInAnonymously,
  GoogleAuthProvider, signInWithPopup, signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
export {
  getFirestore, doc, collection, query, where, orderBy,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction,
  onSnapshot, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
