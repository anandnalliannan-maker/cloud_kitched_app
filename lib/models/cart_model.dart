import 'package:flutter/material.dart';

class CartItem {
  CartItem({
    required this.id,
    required this.name,
    required this.price,
    required this.quantity,
  });

  final String id;
  final String name;
  final int price;
  int quantity;

  int get lineTotal => price * quantity;
}

class CartModel extends ChangeNotifier {
  final Map<String, CartItem> _items = {};

  List<CartItem> get items => _items.values.toList();

  int get total => _items.values.fold(0, (sum, item) => sum + item.lineTotal);

  int quantityFor(String id) => _items[id]?.quantity ?? 0;

  void addItem({
    required String id,
    required String name,
    required int price,
    int? maxQuantity,
  }) {
    if (_items.containsKey(id)) {
      final next = _items[id]!.quantity + 1;
      if (maxQuantity != null && next > maxQuantity) return;
      _items[id]!.quantity = next;
    } else {
      if (maxQuantity != null && maxQuantity < 1) return;
      _items[id] = CartItem(id: id, name: name, price: price, quantity: 1);
    }
    notifyListeners();
  }

  void removeItem(String id) {
    _items.remove(id);
    notifyListeners();
  }

  void updateQuantity(String id, int quantity) {
    if (!_items.containsKey(id)) return;
    if (quantity <= 0) {
      _items.remove(id);
    } else {
      _items[id]!.quantity = quantity;
    }
    notifyListeners();
  }

  void decrement(String id) {
    if (!_items.containsKey(id)) return;
    final next = _items[id]!.quantity - 1;
    updateQuantity(id, next);
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }
}
