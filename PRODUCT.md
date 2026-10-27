# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

UK energy utility procurement traders reviewing national wind forecasts while preparing day-ahead electricity purchases.

## Product Purpose

Show how Elexon's national wind forecast compares with realised wind generation, and quantify forecast error so traders can consider uncertainty when assessing procurement needs.

## Positioning

The dashboard brings Elexon wind forecast accuracy and realised generation into one decision-time view, using only the supplied national wind datasets.

## Operating Context

The current analysis is scoped to the January 2026 delivery window. It supports review of forecasts and outturn around day-ahead procurement decisions.

## Capabilities and Constraints

- Use Elexon BMRS FUELHH actual generation for `fuelType` WIND and WINDFOR forecast generation.
- Preserve the existing API-derived metrics, matched-period chart, and shortfall analysis.
- Do not imply dispatch or procurement recommendations.
- Forecast and actual observations are compared only where the existing analysis matches their delivery timestamps.

## Brand Commitments

The dashboard is presented as Northstar Energy Trading and identifies Elexon BMRS as its data source.

## Evidence on Hand

The application uses Elexon BMRS data and links to the WINDFOR dataset documentation. Do not invent operational performance claims, customer endorsements, or forecast accuracy results.

## Product Principles

- Make decision-relevant data and its time context easy to scan.
- Show uncertainty quantitatively rather than presenting forecasts as certain.
- Keep forecast, outturn, and their differences distinguishable.
- Make data limitations and source provenance visible.
