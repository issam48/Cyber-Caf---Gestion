import { contextBridge, ipcRenderer } from "electron";
import type { AppApi } from "../shared/types";

const api: AppApi = {
  getBusinessSettings: () => ipcRenderer.invoke("business:get"),
  saveBusinessSettings: (value) => ipcRenderer.invoke("business:save", value),
  getTaxSettings: () => ipcRenderer.invoke("tax:get"),
  saveTaxSettings: (value) => ipcRenderer.invoke("tax:save", value),
  getSequences: () => ipcRenderer.invoke("sequences:get"),
  saveSequences: (values) => ipcRenderer.invoke("sequences:save", values),
  chooseImage: () => ipcRenderer.invoke("image:choose"),
  listCustomers: (search) => ipcRenderer.invoke("customers:list", search),
  saveCustomer: (value) => ipcRenderer.invoke("customers:save", value),
  customerSummary: (id) => ipcRenderer.invoke("customers:summary", id),
  listDocuments: (filters) => ipcRenderer.invoke("documents:list", filters),
  getDocument: (id) => ipcRenderer.invoke("documents:get", id),
  getRelatedDocuments: (id) => ipcRenderer.invoke("documents:related", id),
  saveDocument: (value) => ipcRenderer.invoke("documents:save", value),
  issueDocument: (id) => ipcRenderer.invoke("documents:issue", id),
  convertProforma: (id) => ipcRenderer.invoke("documents:convert", id),
  cancelDocument: (id, reason) => ipcRenderer.invoke("documents:cancel", id, reason),
  duplicateDocument: (id) => ipcRenderer.invoke("documents:duplicate", id),
  setQuoteStatus: (id, status) => ipcRenderer.invoke("documents:quote-status", id, status),
  addPayment: (value) => ipcRenderer.invoke("payments:add", value),
  getHistory: (id) => ipcRenderer.invoke("documents:history", id),
  printDocument: (id, exportPdf) => ipcRenderer.invoke("documents:print", id, exportPdf),
  createBackup: () => ipcRenderer.invoke("backup:create"),
  restoreBackup: () => ipcRenderer.invoke("backup:restore"),
  openDataFolder: () => ipcRenderer.invoke("data:open-folder"),
  listWordFiles: (search) => ipcRenderer.invoke("word-files:list", search),
  uploadWordFile: (displayName) => ipcRenderer.invoke("word-files:upload", displayName),
  renameWordFile: (id, displayName) => ipcRenderer.invoke("word-files:rename", id, displayName),
  downloadWordFile: (id) => ipcRenderer.invoke("word-files:download", id),
};

contextBridge.exposeInMainWorld("appApi", api);
