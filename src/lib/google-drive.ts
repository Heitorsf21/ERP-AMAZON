/**
 * Google Drive integration — esqueleto preparatorio.
 * Reutiliza padroes do Gmail OAuth (src/lib/gmail.ts).
 *
 * Proximos passos quando habilitar:
 *  1. Adicionar scope `https://www.googleapis.com/auth/drive.readonly`.
 *  2. Criar /api/drive/auth-url (espelha /api/email/auth-url).
 *  3. Criar /api/drive/callback (espelha /api/email/callback).
 *  4. Endpoint /api/drive/listar-nfs?folderId= que retorna arquivos NF-e.
 *  5. Job opcional para sincronizar periodicamente.
 */
export const GOOGLE_DRIVE_PLACEHOLDER = "Pendente de implementacao.";
