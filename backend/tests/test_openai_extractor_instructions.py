"""Checks the OpenAI extractor's prompt text only -- never a real OpenAI
call."""

from adapters.openai_extractor import EXTRACTION_INSTRUCTIONS


def test_instructions_contain_the_purchase_date_rule():
    # Given the extractor's fixed instructions sent to the AI
    # When checked for the purchase_date date-format rule
    # Then it tells the model to return YYYY-MM-DD, convert German month
    # names and dotted (day-first) dates, and use null if unsure
    assert "YYYY-MM-DD" in EXTRACTION_INSTRUCTIONS
    assert "German month names" in EXTRACTION_INSTRUCTIONS
    assert "dotted dates" in EXTRACTION_INSTRUCTIONS
    assert "day first" in EXTRACTION_INSTRUCTIONS
    assert "null" in EXTRACTION_INSTRUCTIONS
