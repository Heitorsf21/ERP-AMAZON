-- Usuario.email unico GLOBAL (login sem campo empresa).
-- Pre-requisito: nenhum email duplicado entre empresas. A empresa 'udn'
-- (vazia, inativa) que carregava o unico email duplicado e removida ANTES
-- desta migration (via superadmin "excluir empresa").
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
