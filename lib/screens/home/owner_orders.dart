import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/order_service.dart';
import '../../services/user_service.dart';

class OwnerOrdersScreen extends StatefulWidget {
  const OwnerOrdersScreen({super.key});

  @override
  State<OwnerOrdersScreen> createState() => _OwnerOrdersScreenState();
}

class _OwnerOrdersScreenState extends State<OwnerOrdersScreen> {
  final _orderService = OrderService();
  final _userService = UserService();
  final Set<String> _selectedOrderIds = {};

  void _toggleSelection(String id) {
    setState(() {
      if (_selectedOrderIds.contains(id)) {
        _selectedOrderIds.remove(id);
      } else {
        _selectedOrderIds.add(id);
      }
    });
  }

  Future<void> _openAssignSheet() async {
    if (_selectedOrderIds.isEmpty) return;

    await showModalBottomSheet<void>(
      context: context,
      builder: (context) {
        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: _userService.watchActiveDeliveryUsers(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              );
            }

            final docs = snapshot.data?.docs ?? [];
            if (docs.isEmpty) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Text('No active delivery users'),
              );
            }

            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: docs.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final doc = docs[index];
                final data = doc.data();
                final phone = data['phone'] ?? 'Unknown';

                return ListTile(
                  title: Text(phone),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await _orderService.assignOrders(
                      orderIds: _selectedOrderIds.toList(),
                      deliveryUserId: doc.id,
                      deliveryPhone: phone,
                    );
                    if (!mounted || !context.mounted) return;
                    Navigator.of(context).pop();
                    setState(() => _selectedOrderIds.clear());
                  },
                );
              },
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: TabBar(
              tabs: [
                Tab(text: 'Summary'),
                Tab(text: 'Active Orders'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _OwnerOrderSummary(orderService: _orderService),
                _OwnerActiveOrders(
                  orderService: _orderService,
                  selectedOrderIds: _selectedOrderIds,
                  onToggleSelection: _toggleSelection,
                  onAssign: _openAssignSheet,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OwnerOrderSummary extends StatefulWidget {
  const _OwnerOrderSummary({required this.orderService});

  final OrderService orderService;

  @override
  State<_OwnerOrderSummary> createState() => _OwnerOrderSummaryState();
}

class _OwnerOrderSummaryState extends State<_OwnerOrderSummary> {
  final Map<String, bool> _menuChecked = {};

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: widget.orderService.watchOrdersByStatuses(const ['new', 'assigned']),
      builder: (context, orderSnap) {
        if (orderSnap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (orderSnap.hasError) {
          return Center(child: Text('Error loading summary: ${orderSnap.error}'));
        }

        final allOrders = orderSnap.data?.docs ?? [];
        final activeMenuIds = allOrders
            .map((doc) => (doc.data()['publishedMenuId'] ?? '').toString())
            .where((id) => id.isNotEmpty)
            .toSet()
            .toList();

        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: FirebaseFirestore.instance.collection('published_menus').snapshots(),
          builder: (context, menuSnap) {
            final menuDocs = menuSnap.data?.docs ?? [];
            final menuById = <String, Map<String, dynamic>>{
              for (final doc in menuDocs) doc.id: doc.data(),
            };

            for (final id in activeMenuIds) {
              _menuChecked.putIfAbsent(id, () => true);
            }
            _menuChecked.removeWhere((id, _) => !activeMenuIds.contains(id));

            final selectedMenuIds = _menuChecked.entries
                .where((entry) => entry.value)
                .map((entry) => entry.key)
                .toSet();

            final orders = allOrders.where((doc) {
              final menuId = (doc.data()['publishedMenuId'] ?? '').toString();
              if (activeMenuIds.isEmpty) return true;
              return selectedMenuIds.contains(menuId);
            }).toList();

            final totalOrders = orders.length;
            final itemQty = <String, int>{};
            final areaCount = <String, int>{};

            for (final doc in orders) {
              final data = doc.data();
              final items = (data['items'] as List<dynamic>? ?? []);
              for (final raw in items) {
                final item = raw as Map<String, dynamic>;
                final name = (item['name'] ?? 'Item').toString();
                final qty = (item['qty'] ?? 0) as int;
                itemQty[name] = (itemQty[name] ?? 0) + qty;
              }

              final address = data['deliveryAddress'] as Map<String, dynamic>?;
              final area = (address?['area'] ?? 'Unknown').toString();
              areaCount[area] = (areaCount[area] ?? 0) + 1;
            }

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (activeMenuIds.isNotEmpty) ...[
                  const Text(
                    'Filter by Date & Meal',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  Card(
                    child: Column(
                      children: activeMenuIds.map((menuId) {
                        final checked = _menuChecked[menuId] ?? true;
                        final label = _menuLabel(menuId, menuById[menuId]);
                        return CheckboxListTile(
                          value: checked,
                          onChanged: (value) {
                            setState(() {
                              _menuChecked[menuId] = value ?? false;
                            });
                          },
                          title: Text(label),
                          controlAffinity: ListTileControlAffinity.leading,
                          dense: true,
                        );
                      }).toList(),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                Card(
                  child: ListTile(
                    title: const Text('Active Orders'),
                    trailing: Text(
                      '$totalOrders',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 22,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Menu Quantity Summary',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                if (itemQty.isEmpty)
                  const Card(child: ListTile(title: Text('No active order items')))
                else
                  ...itemQty.entries.map(
                    (entry) => Card(
                      child: ListTile(
                        title: Text(entry.key),
                        trailing: Text(
                          '${entry.value}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                const Text(
                  'Active Orders by Area',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                if (areaCount.isEmpty)
                  const Card(child: ListTile(title: Text('No area data')))
                else
                  ...areaCount.entries.map(
                    (entry) => Card(
                      child: ListTile(
                        title: Text(entry.key),
                        trailing: Text(
                          '${entry.value}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                  ),
              ],
            );
          },
        );
      },
    );
  }

  String _menuLabel(String menuId, Map<String, dynamic>? data) {
    if (data == null) return 'Unknown Menu ($menuId)';
    final ts = data['date'] as Timestamp?;
    final date = ts?.toDate();
    final meal = (data['meal'] ?? '').toString().toUpperCase();
    final dateLabel = date == null
        ? 'Unknown Date'
        : '${date.day.toString().padLeft(2, '0')}-${date.month.toString().padLeft(2, '0')}-${date.year}';
    return '$dateLabel - $meal';
  }
}

class _OwnerActiveOrders extends StatelessWidget {
  const _OwnerActiveOrders({
    required this.orderService,
    required this.selectedOrderIds,
    required this.onToggleSelection,
    required this.onAssign,
  });

  final OrderService orderService;
  final Set<String> selectedOrderIds;
  final ValueChanged<String> onToggleSelection;
  final VoidCallback onAssign;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: orderService.watchOrdersByStatuses(const ['new', 'assigned']),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(child: Text('Error loading orders: ${snapshot.error}'));
        }

        final docs = (snapshot.data?.docs ?? []).toList()
          ..sort((a, b) {
            final aTs = a.data()['createdAt'] as Timestamp?;
            final bTs = b.data()['createdAt'] as Timestamp?;
            final aDate = aTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
            final bDate = bTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
            return bDate.compareTo(aDate);
          });

        if (docs.isEmpty) {
          return const Center(child: Text('No active orders'));
        }

        return Column(
          children: [
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: docs.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  final doc = docs[index];
                  final data = doc.data();
                  final status = (data['status'] ?? 'new').toString();
                  final isNew = status == 'new';
                  final rawOrderId = (data['orderId'] ?? doc.id).toString();
                  final orderId = _displayOrderId(rawOrderId);
                  final phone = (data['customerPhone'] ?? 'Unknown').toString();
                  final name = (data['customerName'] ?? 'Customer').toString();
                  final items = (data['items'] as List<dynamic>? ?? [])
                      .cast<Map<String, dynamic>>();
                  final deliveryAddress =
                      data['deliveryAddress'] as Map<String, dynamic>?;
                  final itemDetails = items
                      .map((item) {
                        final itemName = (item['name'] ?? 'Item').toString();
                        final qty = item['qty'] ?? 0;
                        return '$itemName x$qty';
                      })
                      .join(', ');
                  final address = _formatAddress(deliveryAddress);
                  final isSelected = selectedOrderIds.contains(doc.id);

                  return Card(
                    child: ListTile(
                      leading: isNew
                          ? Checkbox(
                              value: isSelected,
                              onChanged: (_) => onToggleSelection(doc.id),
                            )
                          : const Icon(Icons.assignment_turned_in_outlined),
                      title: Text('Order: $orderId'),
                      subtitle: Text(
                        'Status: ${status == 'assigned' ? 'Active' : 'New'}\n'
                        'Name: $name\n'
                        'Phone: $phone\n'
                        'Items: $itemDetails\n'
                        'Address: ${address.isEmpty ? 'N/A' : address}',
                      ),
                      isThreeLine: false,
                      onTap: isNew ? () => onToggleSelection(doc.id) : null,
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: selectedOrderIds.isNotEmpty ? onAssign : null,
                  icon: const Icon(Icons.assignment_ind),
                  label: Text('Assign (${selectedOrderIds.length})'),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  String _displayOrderId(String raw) {
    final parts = raw.split('-');
    if (parts.length < 3) return raw;
    final prefix = parts[0];
    final ymd = parts[1];
    final suffix = parts.sublist(2).join('-');
    if (prefix != 'CK' || ymd.length != 8) return raw;
    final yyyy = ymd.substring(0, 4);
    final mm = ymd.substring(4, 6);
    final dd = ymd.substring(6, 8);
    return 'CK-$dd$mm$yyyy-$suffix';
  }

  String _formatAddress(Map<String, dynamic>? address) {
    if (address == null) return '';
    final flat = (address['flat'] ?? '').toString();
    final apartment = (address['apartment'] ?? '').toString();
    final street = (address['street'] ?? '').toString();
    final area = (address['area'] ?? '').toString();
    return [flat, apartment, street, area]
        .where((part) => part.trim().isNotEmpty)
        .join(', ');
  }
}
