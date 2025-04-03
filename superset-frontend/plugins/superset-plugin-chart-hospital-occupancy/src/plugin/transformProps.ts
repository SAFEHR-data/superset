/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership. The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { ChartProps, TimeseriesDataRecord, CategoricalColorNamespace } from '@superset-ui/core';

export default function transformProps(chartProps: ChartProps) {
  const {
    width,
    height,
    formData,
    queriesData,
    hooks,
    emitCrossFilters,
    filterState,

  } = chartProps;

  const { boldText, headerFontSize, headerText, colorScheme } = formData;

  console.log('color_scheme', colorScheme)
  const colorFn = CategoricalColorNamespace.getScale(colorScheme);

    // Ensure queriesData exists and contains data
  if (!queriesData || !queriesData[0] || !queriesData[0].data) {
    console.warn("No data available in queriesData");
    return { width, height, data: [], boldText, headerFontSize, headerText };
  }

  // Extract column names and ensure they exist
  const query_data = queriesData[0];
  const colnames = query_data.colnames || [];

  if (colnames.length < 2) {
    console.error("Expected at least two columns but found:", colnames);
    return { width, height, data: [], boldText, headerFontSize, headerText };
  }

  // Debugging logs to check changes
  console.log("QueriesData:", queriesData);
  console.log("Columns Found:", colnames);
  console.log("FilterState Before Update:", filterState);

  // Transform the data using the first two columns
  const data = query_data.data

  console.log("Transformed Data:", data);

  const { setDataMask = () => {}, onContextMenu } = hooks;

  // Create the proper return structure without modifying filterState
  // This prevents the infinite loop by not changing filterState on each transform
  return {
    width,
    height,
    data,
    boldText,
    headerFontSize,
    headerText,
    onContextMenu,
    colorFn,
    setDataMask,
    emitCrossFilters: formData.emitCrossFilters || false,
    // colorScheme: selectedColorScheme,
    // Pass through the existing filterState without modifying it
    filterState: filterState || {
      selectedBeds: [],
      appliedSelectedBeds: [],
      history: []
    },
    bedIdCol: colnames[0],
    occupancyTypeCol: colnames[1],
  };
}
