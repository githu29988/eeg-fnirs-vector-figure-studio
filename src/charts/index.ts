/**
 * Side-effectful import barrel for every chart module. Adding a new
 * chart means importing it once here so that its `registerChart` call
 * runs before the sidebar renders.
 */
import './roc-pr';
import './confusion-matrix';
import './calibration-curve';
import './lead-lag-matrix';
import './ablation-funnel';
import './eeg-fnirs-topomap';
import './nvc-alignment';
import './feature-manifold';
import './hegat-map';
import './fusion-flowchart';
import './spatiotemporal-cnn';
import './seizure-focus';
import './dynamic-chord';
import './cortical-3d';
import './architecture-overall';
import './eeg-encoder-detail';
import './fnirs-encoder-detail';

