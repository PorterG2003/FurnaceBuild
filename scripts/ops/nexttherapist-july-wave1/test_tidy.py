#!/usr/bin/env python3
"""Unit checks for tidy() — run: python3 test_tidy.py"""

from __future__ import annotations

import unittest

from send_wave1 import tidy


class TidyTests(unittest.TestCase):
    def test_examples(self) -> None:
        self.assertEqual(tidy("GRETCHEN"), "Gretchen")
        self.assertEqual(tidy("Daniel Daniel"), "Daniel")
        self.assertEqual(tidy("Kara CSW"), "Kara")
        self.assertEqual(tidy("o'brien"), "O'Brien")
        self.assertEqual(tidy("Anne-Marie"), "Anne-Marie")
        self.assertEqual(tidy("Desiree Steadman-Gallegos"), "Desiree")
        self.assertEqual(tidy("JU HYUN"), "Ju")
        self.assertEqual(tidy("Samantha"), "Samantha")
        self.assertIsNone(tidy(""))
        self.assertIsNone(tidy(None))
        self.assertIsNone(tidy("   "))


if __name__ == "__main__":
    unittest.main()
