import importlib
import shutil
from pathlib import Path

import config as config_module

BACKEND_DIR = Path(config_module.__file__).resolve().parent


def reload_config():
    importlib.reload(config_module)
    return config_module


def test_relative_database_path_resolves_against_backend_dir_regardless_of_cwd(
    monkeypatch, tmp_path
):
    # Given DATABASE_PATH is a relative path and the working directory is one folder
    relative_subpath = Path("test_tmp_db_path_check") / "receipts.db"
    monkeypatch.setenv("DATABASE_PATH", str(relative_subpath))
    monkeypatch.chdir(tmp_path)
    reload_config()
    try:
        first_resolved = config_module.DATABASE_PATH

        # When the working directory is switched to a completely different folder
        other_dir = tmp_path / "another"
        other_dir.mkdir()
        monkeypatch.chdir(other_dir)
        reload_config()
        second_resolved = config_module.DATABASE_PATH

        # Then the relative path resolves to the SAME absolute path both times,
        # anchored to backend/ (where config.py lives), not the working directory
        assert first_resolved == second_resolved
        assert first_resolved == BACKEND_DIR / relative_subpath
    finally:
        monkeypatch.undo()
        reload_config()
        shutil.rmtree(BACKEND_DIR / "test_tmp_db_path_check", ignore_errors=True)


def test_default_database_path_also_resolves_against_backend_dir(monkeypatch, tmp_path):
    # Given DATABASE_PATH is unset (falls back to the default) and cwd is some other folder
    monkeypatch.delenv("DATABASE_PATH", raising=False)
    monkeypatch.chdir(tmp_path)
    reload_config()
    try:
        # Then the default also resolves against backend/, not the working directory
        assert config_module.DATABASE_PATH == BACKEND_DIR / "data" / "receipts.db"
    finally:
        monkeypatch.undo()
        reload_config()


def test_absolute_database_path_is_left_unchanged(monkeypatch, tmp_path):
    # Given DATABASE_PATH is an absolute path
    absolute_path = tmp_path / "custom" / "receipts.db"
    monkeypatch.setenv("DATABASE_PATH", str(absolute_path))
    reload_config()
    try:
        # Then it is used exactly as given, not resolved against backend/
        assert config_module.DATABASE_PATH == absolute_path
        # And its parent folder was created
        assert absolute_path.parent.is_dir()
    finally:
        monkeypatch.undo()
        reload_config()
