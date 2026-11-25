import type { DisplayLocale } from "@latex-renderer/shared/locale";

const en = {
  manageFiles: "Manage files",
  editorSettings: "Settings",
  previewSettings: "PDF display settings",
  insertSymbols: "Insert a symbol",
  close: "Close",
};

export type EditorChromeMessage = keyof typeof en;

export const editorChrome = {
  en,
  ja: {
    manageFiles: "ファイル管理",
    editorSettings: "設定",
    previewSettings: "PDFの表示設定",
    insertSymbols: "記号を入力",
    close: "閉じる",
  },
  "zh-CN": {
    manageFiles: "管理文件",
    editorSettings: "设置",
    previewSettings: "PDF 显示设置",
    insertSymbols: "插入符号",
    close: "关闭",
  },
  ko: {
    manageFiles: "파일 관리",
    editorSettings: "설정",
    previewSettings: "PDF 표시 설정",
    insertSymbols: "기호 삽입",
    close: "닫기",
  },
  es: {
    manageFiles: "Gestionar archivos",
    editorSettings: "Ajustes",
    previewSettings: "Ajustes de visualización del PDF",
    insertSymbols: "Insertar un símbolo",
    close: "Cerrar",
  },
  pt: {
    manageFiles: "Gerir ficheiros",
    editorSettings: "Definições",
    previewSettings: "Definições de visualização do PDF",
    insertSymbols: "Inserir um símbolo",
    close: "Fechar",
  },
  fr: {
    manageFiles: "Gérer les fichiers",
    editorSettings: "Paramètres",
    previewSettings: "Paramètres d’affichage du PDF",
    insertSymbols: "Insérer un symbole",
    close: "Fermer",
  },
  de: {
    manageFiles: "Dateien verwalten",
    editorSettings: "Einstellungen",
    previewSettings: "PDF-Anzeigeeinstellungen",
    insertSymbols: "Symbol einfügen",
    close: "Schließen",
  },
  it: {
    manageFiles: "Gestisci file",
    editorSettings: "Impostazioni",
    previewSettings: "Impostazioni di visualizzazione del PDF",
    insertSymbols: "Inserisci un simbolo",
    close: "Chiudi",
  },
  ru: {
    manageFiles: "Управление файлами",
    editorSettings: "Настройки",
    previewSettings: "Настройки отображения PDF",
    insertSymbols: "Вставить символ",
    close: "Закрыть",
  },
  tr: {
    manageFiles: "Dosyaları yönet",
    editorSettings: "Ayarlar",
    previewSettings: "PDF görüntüleme ayarları",
    insertSymbols: "Simge ekle",
    close: "Kapat",
  },
  pl: {
    manageFiles: "Zarządzaj plikami",
    editorSettings: "Ustawienia",
    previewSettings: "Ustawienia wyświetlania PDF",
    insertSymbols: "Wstaw symbol",
    close: "Zamknij",
  },
  cs: {
    manageFiles: "Spravovat soubory",
    editorSettings: "Nastavení",
    previewSettings: "Nastavení zobrazení PDF",
    insertSymbols: "Vložit symbol",
    close: "Zavřít",
  },
  nl: {
    manageFiles: "Bestanden beheren",
    editorSettings: "Instellingen",
    previewSettings: "PDF-weergave-instellingen",
    insertSymbols: "Symbool invoegen",
    close: "Sluiten",
  },
  sv: {
    manageFiles: "Hantera filer",
    editorSettings: "Inställningar",
    previewSettings: "Visningsinställningar för PDF",
    insertSymbols: "Infoga en symbol",
    close: "Stäng",
  },
  no: {
    manageFiles: "Behandle filer",
    editorSettings: "Innstillinger",
    previewSettings: "Visningsinnstillinger for PDF",
    insertSymbols: "Sett inn et symbol",
    close: "Lukk",
  },
  da: {
    manageFiles: "Administrer filer",
    editorSettings: "Indstillinger",
    previewSettings: "Visningsindstillinger for PDF",
    insertSymbols: "Indsæt et symbol",
    close: "Luk",
  },
  fi: {
    manageFiles: "Hallitse tiedostoja",
    editorSettings: "Asetukset",
    previewSettings: "PDF-näkymän asetukset",
    insertSymbols: "Lisää merkki",
    close: "Sulje",
  },
} satisfies Record<DisplayLocale, typeof en>;

export function isEditorChromeMessage(key: string): key is EditorChromeMessage {
  return Object.hasOwn(en, key);
}
