/**
 * Staff Members: manager can change an employee's profile photo.
 * Uploads to that staff member's storage path and writes existing staff photo fields.
 * Never calls ffSaveStaffAvatarMeta for another person (that overwrites the manager's own avatar).
 */
import { db, storage } from "/app.js?v=20260610_force_lp_ios";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

function toast(message, kind) {
  if (typeof window.ffShowAppToast === "function") window.ffShowAppToast(message, kind || "error");
  else alert(message);
}

function currentStaffId() {
  return String(window.__ff_authedStaffId || localStorage.getItem("ff_authedStaffId_v1") || "").trim();
}

function inferExt(file) {
  if (typeof window.ffInferImageExtension === "function") return window.ffInferImageExtension(file);
  var t = String(file && file.type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  return "jpg";
}

function patchLocalStaffPhoto(staffId, url, avatarUpdatedAtMs, staff) {
  if (typeof window.ffGetStaffStore !== "function") return;
  var store = window.ffGetStaffStore();
  var list = store && Array.isArray(store.staff) ? store.staff : [];
  var idx = list.findIndex(function (row) { return row && String(row.id) === String(staffId); });
  if (idx < 0) return;
  var row = Object.assign({}, list[idx]);
  row.photoURL = url;
  row.photoUrl = url;
  row.avatarUrl = url;
  row.avatarUpdatedAtMs = avatarUpdatedAtMs;
  store.staff[idx] = row;
  if (typeof window.ffSyncLegacyWorkersFromStaffStore === "function") {
    window.ffSyncLegacyWorkersFromStaffStore(store, true);
  }
  try { localStorage.setItem("ff_staff_v1", JSON.stringify(store)); } catch (_) {}
  var cache = window.__ffAvatarDirectoryCache;
  if (cache) {
    var entry = {
      staffId: String(staffId),
      photoURL: url,
      avatarUrl: url,
      avatarUpdatedAtMs: avatarUpdatedAtMs
    };
    if (cache.byStaffId) cache.byStaffId[String(staffId)] = Object.assign({}, cache.byStaffId[String(staffId)] || {}, entry);
    var email = String((row.email || (staff && staff.email) || "")).trim().toLowerCase();
    var nameKey = String((row.name || (staff && staff.name) || "")).trim().toLowerCase();
    if (email && cache.byEmail) cache.byEmail[email] = Object.assign({}, cache.byEmail[email] || {}, entry, { email: email });
    if (nameKey && cache.byName) cache.byName[nameKey] = Object.assign({}, cache.byName[nameKey] || {}, entry, { name: row.name, nameKey: nameKey });
  }
  document.dispatchEvent(new CustomEvent("ff-staff-cloud-updated"));
}

async function uploadStaffMemberPhoto(salonId, staffId, file) {
  if (typeof window.ffAssertImageFile === "function") window.ffAssertImageFile(file);
  else if (!file || !file.type || !file.type.startsWith("image/")) throw new Error("Invalid image file");
  var path = "salons/" + salonId + "/staff/" + staffId + "/avatar." + inferExt(file);
  var fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  var url = await getDownloadURL(fileRef);
  return { url: url, path: path };
}

async function saveStaffMemberPhoto(salonId, staffId, url) {
  var avatarUpdatedAtMs = Date.now();
  await updateDoc(doc(db, "salons", salonId, "staff", staffId), {
    photoUrl: url,
    photoURL: url,
    avatarUrl: url,
    avatarUpdatedAtMs: avatarUpdatedAtMs,
    updatedAt: serverTimestamp()
  });
  return avatarUpdatedAtMs;
}

async function handleFile(staff, file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) {
    toast("Please choose an image file.", "error");
    return;
  }
  var salonId = String(window.currentSalonId || "").trim();
  var staffId = String(staff && staff.id || "").trim();
  if (!salonId || !staffId) {
    toast("Could not update photo: missing profile info.", "error");
    return;
  }
  var uploaded = await uploadStaffMemberPhoto(salonId, staffId, file);
  var at = await saveStaffMemberPhoto(salonId, staffId, uploaded.url);
  patchLocalStaffPhoto(staffId, uploaded.url, at, staff);

  if (currentStaffId() && currentStaffId() === staffId && typeof window.ffSaveStaffAvatarMeta === "function") {
    try { await window.ffSaveStaffAvatarMeta({ url: uploaded.url, path: uploaded.path || "" }); } catch (_) {}
  }
  if (typeof window.renderStaffDetails === "function") window.renderStaffDetails();
  toast("Profile photo updated.", "success");
}

function bind(staff) {
  if (!staff || !staff.id) return;
  if (typeof window.ffCurrentUserCanManageStaffPhoto === "function" && !window.ffCurrentUserCanManageStaffPhoto()) return;
  var btn = document.getElementById("staffDetailsAvatarEditBtn");
  var input = document.getElementById("staffDetailsAvatarInput");
  if (!btn || !input) return;
  btn.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    input.click();
  };
  input.onchange = async function (ev) {
    var file = ev.target && ev.target.files && ev.target.files[0];
    if (ev.target) ev.target.value = "";
    if (!file) return;
    btn.disabled = true;
    try {
      await handleFile(staff, file);
    } catch (err) {
      console.error("[StaffAvatar] upload failed", err);
      toast("Couldn't update this profile photo. Please try again.", "error");
    } finally {
      btn.disabled = false;
    }
  };
}

window.ffBindStaffDetailsAvatarUpload = bind;
