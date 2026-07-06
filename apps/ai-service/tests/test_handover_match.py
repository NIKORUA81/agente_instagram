from app.services.reply_service import _matches_handover_keyword


def test_matches_accent_insensitive() -> None:
    kws = ["humano", "agente", "asesor"]
    assert _matches_handover_keyword("Quiero hablar con un HUMANO por favor", kws)
    assert _matches_handover_keyword("me pasas un asésor?", kws)
    assert not _matches_handover_keyword("cuánto cuesta el envío", kws)


def test_ignores_empty_keywords() -> None:
    assert not _matches_handover_keyword("hola", ["", "  "])
