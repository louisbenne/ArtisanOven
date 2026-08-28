  var maxLimit = parseFloat(settings.maxPizzas || 20);

  var sessionPizzaCapacity = 0;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (rowIsBlank(row)) continue;

    var isCurrentSession = (r >= sessionStartRow);
    var pizzasBeforeThisOrder = sessionPizzas;
    var capacityBeforeThisOrder = sessionPizzaCapacity;

    var stats = calculateRowPizzaStats(row);
    if (isCurrentSession) {
      sessionPizzaCapacity += stats.pizzaCapacity;
    }

    var allergyYN = safeTrim(row[1]);
